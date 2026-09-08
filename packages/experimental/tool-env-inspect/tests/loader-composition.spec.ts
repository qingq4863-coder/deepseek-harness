// Proves both tools are real configurability and not constants: bounds are set in a cordis.yml
// booted through the real Loader, misconfiguration fails at load, and the tools answer through
// the registry end to end — `env_version` through the real approval seam and local subprocess
// provider, running the host's own `node --version`.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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
import * as ToolEnvInspect from '@deepseek-ai/dsh-experimental-tool-env-inspect'

const IS_WIN32 = process.platform === 'win32'

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
]

const ENV_CONFIG = [
  "- name: '@deepseek-ai/dsh-experimental-tool-env-inspect'",
  '  config:',
  '    maxCommands: 1',
  '    versionMaxCommands: 2',
  '    versionTimeoutMs: 15000',
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

  it.each([
    { label: 'is omitted', configLines: [], failure: '$.maxCommands missing required value' },
    { label: 'is not a number', configLines: ['    maxCommands: "many"'], failure: '$.maxCommands expected number' },
    { label: 'is out of range', configLines: ['    maxCommands: 0', '    versionMaxCommands: 2', '    versionTimeoutMs: 15000'], failure: 'maxCommands must be an integer between 1 and 64' },
    { label: 'is omitted for versionMaxCommands', configLines: ['    maxCommands: 8'], failure: '$.versionMaxCommands missing required value' },
    { label: 'is out of range for versionMaxCommands', configLines: ['    maxCommands: 8', '    versionMaxCommands: 0', '    versionTimeoutMs: 15000'], failure: 'versionMaxCommands must be an integer between 1 and 32' },
    { label: 'is out of range for versionTimeoutMs', configLines: ['    maxCommands: 8', '    versionMaxCommands: 2', '    versionTimeoutMs: 50'], failure: 'versionTimeoutMs must be an integer between 1000 and 120000' },
  ])('fails loading when $label', async ({ configLines, failure }) => {
    // Every bound is self-contained, so misconfiguration fails at load: the entry's apply
    // rejects and boot never reaches a running tool.
    const probeDir = join(root ?? '', 'bin')
    await mkdir(probeDir, { recursive: true })
    vi.stubEnv('PATH', probeDir)
    await expect(boot([...BASE_ENTRIES, "- name: '@deepseek-ai/dsh-experimental-tool-env-inspect'", '  config:', ...configLines])).rejects.toThrow(failure)
  }, 30_000)
})
