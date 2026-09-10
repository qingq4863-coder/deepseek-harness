/**
 * Environment inspection for the installer/environment-manager plan. `env_inspect` resolves
 * command names against the caller's `PATH` and reports where each executable lives — nothing
 * is executed, downloaded, or installed there, and resolution runs in-process against the
 * filesystem. `env_version` is the package's one execution surface: it runs a resolved
 * executable's `--version` in a bounded child process, one approval decision per probe ahead
 * of every run. `apps_inspect` enumerates installed applications from read-only Windows
 * inventory sources through the optional shell seam, returning sanitized metadata only.
 * Download, install, and verification stay out of scope.
 * @module @deepseek-ai/dsh-experimental-tool-env-inspect
 */

import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-user-approval'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerAppsTools } from './apps-tool.ts'
import { registerPkgInspect } from './pkg-tool.ts'
import { registerPkgPropose } from './pkg-propose.ts'
import { registerPkgMutation } from './pkg-mutation.ts'
import type { EnvCommandProbe, EnvVersionProbe } from './types.ts'

export type * from './types.ts'
export { APPS_INVENTORY_SCRIPT, APP_INVENTORY_COVERAGE, APP_SOURCE_IDS, appId, buildApps, classifyArch, classifyInstaller, classifyKind, coverageDiffers, createInventoryReader, diffApps, notCoveredFor, parseInventoryOutput, sanitizeField, snapshotId, unavailableSources } from './apps.ts'
export type { AppDiff, InventoryCollection, InventoryReader, InventoryReaderOptions, RawInventory, RawInventoryRow, SanitizedField } from './apps.ts'
export { filterApps, registerAppsTools, renderApps, renderDiff } from './apps-tool.ts'
export type { AppsDiffArgs, AppsInspectArgs, AppsInspectConfig } from './apps-tool.ts'
export { buildPackages, packageId, PKG_INVENTORY_COVERAGE, PKG_MANAGER_IDS, PKG_PROBES, pkgNotCovered } from './pkg.ts'
export type { ParsedPackage, ParseOutcome, PkgProbe } from './pkg.ts'
export { registerPkgInspect, renderPkgInspect } from './pkg-tool.ts'
export type { PkgInspectArgs, PkgInspectConfig } from './pkg-tool.ts'
export { PROPOSE_COVERAGE, PROPOSE_PROBES, registerPkgPropose, renderProposal, sanitizeProposal } from './pkg-propose.ts'
export type { ProposeProbe } from './pkg-propose.ts'
export { MUTATION_COMMANDS, registerPkgMutation, renderMutation } from './pkg-mutation.ts'
export type { PkgMutationArgs, PkgMutationConfig, PkgMutationOutcome } from './pkg-mutation.ts'

export const name = 'tool-env-inspect'
export const inject = ['tools', 'approval', 'subprocess']

/** The fallback PATHEXT order on Windows, used when the environment declares none. */
const WINDOWS_FALLBACK_EXTENSIONS = ['.com', '.exe', '.bat', '.cmd']

/**
 * Fixed result bound of one `env_version` probe: the per-stream collected-output cap of the
 * `--version` child. Version banners are short; the bound exists so a noisy program cannot
 * stream unbounded text into the model-visible result. Not a deployment tunable.
 */
const VERSION_OUTPUT_MAX_BYTES = 4096

/**
 * Fixed terminate-escalation grace for the `--version` child tree. The deadline that owns
 * cancellation is `versionTimeoutMs`; the grace only shapes the tree teardown after it.
 */
const VERSION_GRACE_MS = 1000

/** Model-facing env-inspect tool configuration. */
export interface Config {
  /**
   * Required deployment choice for how many distinct command names one `env_inspect` call may
   * probe. Each command yields one structured result entry, so this bound is the result-size
   * bound; the accepted range is 1-64, and a value outside it fails at load.
   */
  maxCommands: number
  /**
   * Required deployment choice for how many distinct command names one `env_version` call may
   * probe. Each command runs its own approved child process, so this bound is also the bound
   * on approval decisions and child processes per call; the accepted range is 1-32, and a
   * value outside it fails at load.
   */
  versionMaxCommands: number
  /**
   * Required deployment choice for the deadline of one `env_version` child process, in
   * milliseconds. Expiry aborts the process tree and the probe reports a timeout; the
   * accepted range is 1000-120000, and a value outside it fails at load.
   */
  versionTimeoutMs: number
  /**
   * Required deployment choice for how many installed-application entries one `apps_inspect`
   * call returns when the model omits `limit`. The accepted range is 1-200 and it must not
   * exceed `appsMaxLimit`, and a value outside that fails at load.
   */
  appsDefaultLimit: number
  /**
   * Required deployment choice for the largest `limit` one `apps_inspect` call may use. The
   * accepted range is 1-200, and a value outside it fails at load.
   */
  appsMaxLimit: number
  /**
   * Required deployment choice for the installed-application snapshot cache lifetime, in
   * milliseconds. `0` disables caching so every call reads the machine again; the accepted
   * range is 0-3600000, and a value outside it fails at load.
   */
  appsCacheTtlMs: number
  /**
   * Required deployment choice for the deadline of one installed-application collection run,
   * in milliseconds. Expiry aborts the shell process tree and the result reports the sources as
   * not read; the accepted range is 1000-120000, and a value outside it fails at load.
   */
  appsTimeoutMs: number
  /**
   * Required deployment choice for how many named `apps_snapshot` captures one composition keeps
   * before evicting the oldest. The accepted range is 1-50, and a value outside it fails at load.
   */
  appsMaxSnapshots: number
  /**
   * Required deployment choice for how many packages one `pkg_inspect` call returns when the
   * model omits `limit`. The accepted range is 1-`pkgMaxPackages`, and a value outside it fails
   * at load.
   */
  pkgDefaultLimit: number
  /**
   * Required deployment choice for the largest `limit` one `pkg_inspect` call may use. The
   * accepted range is 1-500, and a value outside it fails at load.
   */
  pkgMaxPackages: number
  /**
   * Required deployment choice for the deadline of one package-manager probe, in milliseconds.
   * Expiry aborts the probe's process tree; the accepted range is 1000-120000, and a value
   * outside it fails at load.
   */
  pkgTimeoutMs: number
  /**
   * Required deployment choice for the deadline of one `pkg_install`/`pkg_uninstall` run, in
   * milliseconds. Installs legitimately run long, so the range is wider than a probe's; expiry
   * aborts the process tree, and the accepted range is 1000-600000.
   */
  pkgInstallTimeoutMs: number
}

/** Schemastery configuration for the env-inspect tool consumer. */
export const Config: z<Config> = z.object({
  maxCommands: z.number().required(),
  versionMaxCommands: z.number().required(),
  versionTimeoutMs: z.number().required(),
  appsDefaultLimit: z.number().required(),
  appsMaxLimit: z.number().required(),
  appsCacheTtlMs: z.number().required(),
  appsTimeoutMs: z.number().required(),
  appsMaxSnapshots: z.number().required(),
  pkgDefaultLimit: z.number().required(),
  pkgMaxPackages: z.number().required(),
  pkgTimeoutMs: z.number().required(),
  pkgInstallTimeoutMs: z.number().required(),
})

function pathDirectories(env: NodeJS.ProcessEnv): string[] {
  const separator = process.platform === 'win32' ? ';' : ':'
  return (env.PATH ?? '').split(separator).filter(segment => segment.length > 0)
}

function executableExtensions(env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32') return ['']
  const declared = (env.PATHEXT ?? '')
    .split(';')
    .map(ext => ext.trim().toLowerCase())
    .filter(ext => ext.length > 0)
    .map(ext => ext.startsWith('.') ? ext : `.${ext}`)
  return declared.length > 0 ? declared : WINDOWS_FALLBACK_EXTENSIONS
}

/**
 * Whether the path names a regular file this platform's shell would execute. On POSIX this means
 * the executable bit; on Windows, existence — the caller has already matched a PATHEXT
 * extension, and `access(X_OK)` tests existence only there.
 */
async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    const stats = await stat(candidate)
    if (!stats.isFile()) return false
    if (process.platform === 'win32') return true
    await access(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve each command name against the PATH in `env`, keeping request order and skipping
 * duplicates. Windows treats a request already ending in an executable extension as an exact
 * file name and otherwise tries every PATHEXT suffix in order inside each directory; POSIX
 * requires the executable bit on a regular file. Purely read-only: matching is done with
 * `stat`/`access`, and no candidate is ever executed.
 * @param commands - bare command names, never paths.
 * @param env - the process environment to resolve against; defaults to `process.env`.
 * @returns one probe per distinct command, in request order.
 */
export async function resolveCommands(commands: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<EnvCommandProbe[]> {
  const directories = pathDirectories(env)
  const extensions = executableExtensions(env)
  const probes: EnvCommandProbe[] = []
  const seen = new Set<string>()
  for (const command of commands) {
    if (seen.has(command)) continue
    seen.add(command)
    const paths: string[] = []
    for (const directory of directories) {
      const bare = join(directory, command)
      if (process.platform === 'win32') {
        const lower = command.toLowerCase()
        const exact = extensions.some(ext => lower.endsWith(ext))
        const candidates = exact ? [bare] : extensions.map(ext => bare + ext)
        for (const candidate of candidates) {
          if (await isExecutableFile(candidate)) paths.push(candidate)
        }
      } else if (await isExecutableFile(bare)) {
        paths.push(bare)
      }
    }
    probes.push({ command, paths })
  }
  return probes
}

/** Validate the bare command names both tools accept; path-shaped and blank names fail. */
function validateCommandNames(commands: readonly string[]): void {
  for (const command of commands) {
    if (command.trim().length === 0) {
      throw new Error('invalid probe: command names must be non-empty')
    }
    if (command.includes('/') || command.includes('\\')) {
      throw new Error(`invalid probe: \`${command}\` must be a bare command name, not a path`)
    }
  }
}

/**
 * Register the environment tools on `ctx.tools`. Config bounds fail loud at load. The package
 * requires the `approval` and `subprocess` services so every `env_version` probe can ask for a
 * one-shot decision and run its child through the shared process seam; a composition that omits
 * either service fails at injection. `apps_inspect` resolves the optional `shell` service at
 * call time, so a composition without a shell executor still loads and reports its inventory
 * sources as not read.
 * @param ctx - registrant context carrying the tool registry, approval seam, and subprocess seam.
 * @param config - deployment's explicit probe bounds, version deadline, and inventory bounds.
 */
export function apply(ctx: Context, config: Config): void {
  const { maxCommands, versionMaxCommands, versionTimeoutMs } = config
  if (!Number.isInteger(maxCommands) || maxCommands < 1 || maxCommands > 64) {
    throw new Error('tool-env-inspect config.maxCommands must be an integer between 1 and 64')
  }
  if (!Number.isInteger(versionMaxCommands) || versionMaxCommands < 1 || versionMaxCommands > 32) {
    throw new Error('tool-env-inspect config.versionMaxCommands must be an integer between 1 and 32')
  }
  if (!Number.isInteger(versionTimeoutMs) || versionTimeoutMs < 1000 || versionTimeoutMs > 120000) {
    throw new Error('tool-env-inspect config.versionTimeoutMs must be an integer between 1000 and 120000')
  }
  if (!Number.isInteger(config.appsMaxLimit) || config.appsMaxLimit < 1 || config.appsMaxLimit > 200) {
    throw new Error('tool-env-inspect config.appsMaxLimit must be an integer between 1 and 200')
  }
  if (!Number.isInteger(config.appsDefaultLimit) || config.appsDefaultLimit < 1 || config.appsDefaultLimit > config.appsMaxLimit) {
    throw new Error('tool-env-inspect config.appsDefaultLimit must be an integer between 1 and config.appsMaxLimit')
  }
  if (!Number.isInteger(config.appsCacheTtlMs) || config.appsCacheTtlMs < 0 || config.appsCacheTtlMs > 3_600_000) {
    throw new Error('tool-env-inspect config.appsCacheTtlMs must be an integer between 0 and 3600000')
  }
  if (!Number.isInteger(config.appsTimeoutMs) || config.appsTimeoutMs < 1000 || config.appsTimeoutMs > 120000) {
    throw new Error('tool-env-inspect config.appsTimeoutMs must be an integer between 1000 and 120000')
  }
  if (!Number.isInteger(config.appsMaxSnapshots) || config.appsMaxSnapshots < 1 || config.appsMaxSnapshots > 50) {
    throw new Error('tool-env-inspect config.appsMaxSnapshots must be an integer between 1 and 50')
  }
  if (!Number.isInteger(config.pkgMaxPackages) || config.pkgMaxPackages < 1 || config.pkgMaxPackages > 500) {
    throw new Error('tool-env-inspect config.pkgMaxPackages must be an integer between 1 and 500')
  }
  if (!Number.isInteger(config.pkgDefaultLimit) || config.pkgDefaultLimit < 1 || config.pkgDefaultLimit > config.pkgMaxPackages) {
    throw new Error('tool-env-inspect config.pkgDefaultLimit must be an integer between 1 and config.pkgMaxPackages')
  }
  if (!Number.isInteger(config.pkgTimeoutMs) || config.pkgTimeoutMs < 1000 || config.pkgTimeoutMs > 120000) {
    throw new Error('tool-env-inspect config.pkgTimeoutMs must be an integer between 1000 and 120000')
  }
  if (!Number.isInteger(config.pkgInstallTimeoutMs) || config.pkgInstallTimeoutMs < 1000 || config.pkgInstallTimeoutMs > 600000) {
    throw new Error('tool-env-inspect config.pkgInstallTimeoutMs must be an integer between 1000 and 600000')
  }
  ctx.tools.register(defineTool({
    name: 'env_inspect',
    description: 'Inspect which commands are installed on this machine. Send a list of command '
      + 'names (e.g. `git`, `python`); each comes back with the executable paths found on PATH — '
      + 'the first one is what a shell would run — or an empty list when it is not installed. '
      + 'Read-only: nothing is executed, downloaded, or installed. Only executable files on PATH '
      + 'are visible; shell built-ins and aliases are not. For applications installed outside PATH, '
      + 'use apps_inspect.',
    parameters: {
      commands: {
        type: 'array',
        required: true,
        description: 'Command names to look up, without paths or arguments.',
        items: {
          type: 'string',
          description: 'A bare command name, e.g. `git`.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          probes: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                command: { type: 'string', required: true },
                paths: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.probes
          .map(probe => `${probe.command}: ${probe.paths.length > 0 ? probe.paths[0] : 'not found'}`)
          .join('\n'),
      }],
    },
    capability: {
      dataClass: 'workspace',
      risk: 'low',
      readScope: ['PATH'],
      writeScope: [],
      network: [],
      reversible: true,
      approval: 'automatic',
    },
    execute(args) {
      const commands = [...new Set(args.commands)]
      if (commands.length > maxCommands) {
        throw new Error(`env_inspect accepts at most ${maxCommands} distinct commands per call (got ${commands.length})`)
      }
      validateCommandNames(commands)
      return resolveCommands(commands).then(probes => ({ probes }))
    },
    presentCall: args => ({ card: 'generic', title: 'Inspect installed commands', kind: 'other', rawInput: args.commands }),
  }))

  ctx.tools.register(defineTool({
    name: 'env_version',
    description: 'Probe installed command versions. Send a list of command names (e.g. `git`, '
      + '`node`); each name is resolved on PATH, and its `--version` output is captured from a '
      + 'time-limited child process. Every probe asks for a one-shot approval decision before '
      + 'the child runs and is denied when the decision is not an allow, so this tool executes '
      + 'programs — unlike env_inspect, which never runs anything.',
    parameters: {
      commands: {
        type: 'array',
        required: true,
        description: 'Command names to probe, without paths or arguments.',
        items: {
          type: 'string',
          description: 'A bare command name, e.g. `git`.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          probes: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                command: { type: 'string', required: true },
                path: { type: 'string' },
                version: { type: 'string' },
                error: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.probes
          .map((probe) => {
            if (probe.version !== undefined) return `${probe.command}: ${probe.version} (${probe.path})`
            if (probe.error !== undefined) return `${probe.command}: ${probe.error}`
            return `${probe.command}: no version reported`
          })
          .join('\n'),
      }],
    },
    capability: {
      dataClass: 'workspace',
      risk: 'medium',
      readScope: ['PATH'],
      writeScope: [],
      network: [],
      reversible: true,
      approval: 'scoped',
    },
    async execute(args, exec) {
      if (exec.agent === undefined) {
        throw new Error('env_version requires an owning agent session so approvals are recorded')
      }
      const { agent, callId } = exec
      const commands = [...new Set(args.commands)]
      if (commands.length > versionMaxCommands) {
        throw new Error(`env_version accepts at most ${versionMaxCommands} distinct commands per call (got ${commands.length})`)
      }
      validateCommandNames(commands)
      const probes: EnvVersionProbe[] = []
      for (const command of commands) {
        probes.push(await probeVersion(command))
      }
      return { probes }

      async function probeVersion(command: string): Promise<EnvVersionProbe> {
        let executable: string
        try {
          executable = await ctx.subprocess.resolveExecutable(command)
        } catch {
          // resolveExecutable fails loud exactly when no executable resolves; for a version
          // probe that is the not-installed answer, and nothing else can reach this catch.
          return { command, error: 'not found' }
        }
        const decision = await ctx.approval.request({
          agent,
          toolName: 'env_version',
          callId,
          reason: `run "${executable}" --version`,
        })
        if (decision !== 'allowed-once') {
          return { command, error: `denied by approval decision (${decision})` }
        }
        const deadline = new AbortController()
        const timer = setTimeout(() => { deadline.abort() }, versionTimeoutMs)
        try {
          const handle = ctx.subprocess.spawn({
            argv: [executable, '--version'],
            cwd: process.cwd(),
            stdio: {
              stdin: 'ignore',
              stdout: { maxBytes: VERSION_OUTPUT_MAX_BYTES },
              stderr: { maxBytes: VERSION_OUTPUT_MAX_BYTES },
            },
            graceMs: VERSION_GRACE_MS,
            signal: deadline.signal,
          })
          const { exitCode } = await handle.done
          const stdout = handle.collected.stdout?.readFrom(0).text.trim() ?? ''
          if (exitCode !== 0) {
            const stderr = handle.collected.stderr?.readFrom(0).text.trim() ?? ''
            const cause = deadline.signal.aborted
              ? `timed out after ${versionTimeoutMs}ms`
              : exitCode === null ? 'terminated before exit' : `exited with code ${exitCode}`
            return { command, path: executable, error: stderr.length > 0 ? `${cause}: ${stderr}` : cause }
          }
          return { command, path: executable, version: stdout.length > 0 ? stdout : '(no output)' }
        } catch (error) {
          // Spawn-level failures only: a started child always settles `done` with exit facts.
          return {
            command,
            path: executable,
            error: `failed to run: ${error instanceof Error ? error.message : String(error)}`,
          }
        } finally {
          clearTimeout(timer)
        }
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Probe command versions', kind: 'other', rawInput: args.commands }),
  }))

  registerAppsTools(ctx, config)
  registerPkgInspect(ctx, config)
  registerPkgPropose(ctx, config)
  registerPkgMutation(ctx, config)
}
