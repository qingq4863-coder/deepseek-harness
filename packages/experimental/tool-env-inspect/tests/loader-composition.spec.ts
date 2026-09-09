// Proves both tools are real configurability and not constants: bounds are set in a cordis.yml
// booted through the real Loader, misconfiguration fails at load, and the tools answer through
// the registry end to end — `env_version` through the real approval seam and local subprocess
// provider, running the host's own `node --version`.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import PwshLocalExecutor, { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import * as ToolEnvInspect from '@deepseek-ai/dsh-experimental-tool-env-inspect'

const IS_WIN32 = process.platform === 'win32'

// apps_inspect reads real Windows inventory through the governed pwsh channel, so the real
// end-to-end case needs both a Windows host and a spawnable PowerShell (the same probe
// vitest.config.ts uses to exempt pwsh-local's own suites).
const HAS_PWSH = spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8' }).status === 0

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  vi.unstubAllEnvs()
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

let agentCounter = 0

function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId(`env-loader-agent-${++agentCounter}`)
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

/**
 * Boot a cordis.yml carrying the given plugin entries through the real Loader with every
 * service `env_version` injects: the approval seam (with its session store) and the local
 * subprocess provider.
 * @param entries - complete YAML lines, one plugin entry each.
 * @returns the booted context.
 */
async function boot(entries: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-env-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...entries, ''].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-user-approval', ApprovalService],
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
    ['@deepseek-ai/dsh-pwsh-local', PwshLocalExecutor],
    ['@deepseek-ai/dsh-experimental-tool-env-inspect', ToolEnvInspect],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

const BASE_ENTRIES = [
  "- name: '@deepseek-ai/dsh-agent'",
  "- name: '@deepseek-ai/dsh-session'",
  "- name: '@deepseek-ai/dsh-system-prompt'",
  "- name: '@deepseek-ai/dsh-tools'",
  "- name: '@deepseek-ai/dsh-user-approval'",
  "- name: '@deepseek-ai/dsh-subprocess-local'",
  "- name: '@deepseek-ai/dsh-pwsh-local'",
]

const ENV_CONFIG = [
  "- name: '@deepseek-ai/dsh-experimental-tool-env-inspect'",
  '  config:',
  '    maxCommands: 1',
  '    versionMaxCommands: 2',
  '    versionTimeoutMs: 15000',
  '    appsDefaultLimit: 5',
  '    appsMaxLimit: 10',
  '    appsCacheTtlMs: 0',
  '    appsTimeoutMs: 60000',
  '    appsMaxSnapshots: 2',
]

describe('tool-env-inspect real Loader composition through cordis.yml', () => {
  it('maxCommands bounds a call end to end', async () => {
    const probeDir = join(root ?? '', 'bin')
    await mkdir(probeDir, { recursive: true })
    await writeFile(join(probeDir, IS_WIN32 ? 'probe.cmd' : 'probe'), '')
    vi.stubEnv('PATH', probeDir)

    const ctx = await boot([...BASE_ENTRIES, ...ENV_CONFIG])
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('env-bound'),
      name: 'env_inspect',
      arguments: { commands: ['probe', 'other'] },
      agent: agent(ctx),
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('at most 1 distinct commands')

    const accepted = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('env-ok'),
      name: 'env_inspect',
      arguments: { commands: ['probe'] },
      agent: agent(ctx),
    })
    expect(accepted.isError).toBe(false)
    expect(resultText(accepted)).toContain('probe: ')
  }, 30_000)

  it('env_version runs an approved node --version end to end', async () => {
    const ctx = await boot([...BASE_ENTRIES, ...ENV_CONFIG])
    ctx.on('approval/request', () => Promise.resolve('allowed-once'))
    const caller = agent(ctx)
    caller.session.append('turn/start', { turn: 1 })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('env-version-ok'),
      name: 'env_version',
      arguments: { commands: ['node'] },
      agent: caller,
    })
    expect(result.isError).toBe(false)
    expect(resultText(result)).toMatch(/node: v?\d[^\n]*\(/)
  }, 30_000)

  it('env_version fails closed without an answerer and rejects an unknown command before asking', async () => {
    const ctx = await boot([...BASE_ENTRIES, ...ENV_CONFIG])
    const caller = agent(ctx)
    caller.session.append('turn/start', { turn: 1 })
    const denied = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('env-version-denied'),
      name: 'env_version',
      arguments: { commands: ['node'] },
      agent: caller,
    })
    expect(denied.isError).toBe(false)
    expect(resultText(denied)).toContain('node: denied by approval decision (unavailable)')

    const unresolved = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('env-version-missing'),
      name: 'env_version',
      arguments: { commands: ['definitely-missing-cmd'] },
      agent: agent(ctx),
    })
    expect(resultText(unresolved)).toContain('definitely-missing-cmd: not found')
  }, 30_000)

  it.skipIf(!IS_WIN32 || !HAS_PWSH)('apps_inspect reads the real machine through the governed pwsh channel', async () => {
    const ctx = await boot([...BASE_ENTRIES, ...ENV_CONFIG])
    ctx.on('approval/request', () => Promise.resolve('allowed-once'))
    const caller = agent(ctx)
    caller.session.append('turn/start', { turn: 1 })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('apps-real'),
      name: 'apps_inspect',
      arguments: { limit: 3 },
      agent: caller,
    })
    expect(result.isError).toBe(false)
    const text = resultText(result)
    expect(text).toMatch(/Installed applications: \d+ of \d+ matching/u)
    // Uninstall commands are a change surface and never reach the model.
    expect(text).not.toMatch(/msiexec|uninstallstring|quietuninstall/iu)
  }, 120_000)

  it.skipIf(!IS_WIN32 || !HAS_PWSH)('apps_snapshot and apps_diff compare two real observations of the machine', async () => {
    const ctx = await boot([...BASE_ENTRIES, ...ENV_CONFIG])
    ctx.on('approval/request', () => Promise.resolve('allowed-once'))
    const caller = agent(ctx)
    caller.session.append('turn/start', { turn: 1 })
    const captured = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('apps-snapshot-real'),
      name: 'apps_snapshot',
      arguments: { name: 'baseline' },
      agent: caller,
    })
    expect(captured.isError).toBe(false)
    expect(resultText(captured)).toMatch(/Captured snapshot "baseline": \d+ entries/u)

    const diff = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('apps-diff-real'),
      name: 'apps_diff',
      arguments: { from: 'baseline', limit: 5 },
      agent: caller,
    })
    expect(diff.isError).toBe(false)
    // Two immediate reads of the same machine normally agree; a real change is equally valid.
    expect(resultText(diff)).toMatch(/Installed-application diff "baseline" → "now": (no change\.|\d+ added, \d+ removed, \d+ changed\.)/u)
  }, 120_000)

  it.each([
    { label: 'is omitted', overrides: { maxCommands: undefined }, failure: '$.maxCommands missing required value' },
    { label: 'is not a number', overrides: { maxCommands: '"many"' }, failure: '$.maxCommands expected number' },
    { label: 'is out of range', overrides: { maxCommands: 0 }, failure: 'maxCommands must be an integer between 1 and 64' },
    { label: 'is omitted for versionMaxCommands', overrides: { versionMaxCommands: undefined }, failure: '$.versionMaxCommands missing required value' },
    { label: 'is out of range for versionMaxCommands', overrides: { versionMaxCommands: 0 }, failure: 'versionMaxCommands must be an integer between 1 and 32' },
    { label: 'is out of range for versionTimeoutMs', overrides: { versionTimeoutMs: 50 }, failure: 'versionTimeoutMs must be an integer between 1000 and 120000' },
    { label: 'is omitted for appsDefaultLimit', overrides: { appsDefaultLimit: undefined }, failure: '$.appsDefaultLimit missing required value' },
    { label: 'is out of range for appsMaxLimit', overrides: { appsMaxLimit: 0 }, failure: 'appsMaxLimit must be an integer between 1 and 200' },
    { label: 'exceeds appsMaxLimit', overrides: { appsDefaultLimit: 20 }, failure: 'appsDefaultLimit must be an integer between 1 and config.appsMaxLimit' },
    { label: 'is out of range for appsCacheTtlMs', overrides: { appsCacheTtlMs: -1 }, failure: 'appsCacheTtlMs must be an integer between 0 and 3600000' },
    { label: 'is out of range for appsTimeoutMs', overrides: { appsTimeoutMs: 50 }, failure: 'appsTimeoutMs must be an integer between 1000 and 120000' },
    { label: 'is omitted for appsMaxSnapshots', overrides: { appsMaxSnapshots: undefined }, failure: '$.appsMaxSnapshots missing required value' },
    { label: 'is out of range for appsMaxSnapshots', overrides: { appsMaxSnapshots: 0 }, failure: 'appsMaxSnapshots must be an integer between 1 and 50' },
  ])('fails loading when $label', async ({ overrides, failure }) => {
    // Every bound is self-contained, so misconfiguration fails at load: the entry's apply
    // rejects and boot never reaches a running tool.
    const probeDir = join(root ?? '', 'bin')
    await mkdir(probeDir, { recursive: true })
    vi.stubEnv('PATH', probeDir)
    const config = {
      maxCommands: 8,
      versionMaxCommands: 2,
      versionTimeoutMs: 15000,
      appsDefaultLimit: 5,
      appsMaxLimit: 10,
      appsCacheTtlMs: 0,
      appsTimeoutMs: 30000,
      appsMaxSnapshots: 3,
      ...overrides,
    }
    const lines = Object.entries(config)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `    ${key}: ${value as string}`)
    await expect(boot([...BASE_ENTRIES, "- name: '@deepseek-ai/dsh-experimental-tool-env-inspect'", '  config:', ...lines])).rejects.toThrow(failure)
  }, 30_000)
})
