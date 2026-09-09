// Behavior matrix for the env_inspect tool: PATH resolution semantics per platform, call bounds,
// and HMR disposal. Resolution is exercised through `resolveCommands` with an injected
// environment so tests never depend on the host machine's real PATH.
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import * as ToolEnvInspect from '../src/index.ts'

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

async function makeDirWith(name: string, mode?: number): Promise<string> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-env-inspect-'))
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  const file = join(dir, IS_WIN32 ? 'probe.cmd' : 'probe')
  await writeFile(file, '')
  if (mode !== undefined && !IS_WIN32) await chmod(file, mode)
  return dir
}

function envWith(...directories: readonly string[]): NodeJS.ProcessEnv {
  return { PATH: directories.join(IS_WIN32 ? ';' : ':'), ...(IS_WIN32 ? { PATHEXT: '.cmd' } : {}) }
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

describe('resolveCommands', () => {
  it('reports an empty path list for an unknown command', async () => {
    const probes = await ToolEnvInspect.resolveCommands(['definitely-missing-cmd'], envWith(''))
    expect(probes).toEqual([{ command: 'definitely-missing-cmd', paths: [] }])
  })

  it('finds an executable in a PATH directory and reports the full path', async () => {
    const dir = await makeDirWith('present')
    const probes = await ToolEnvInspect.resolveCommands(['probe'], envWith(dir))
    expect(probes[0]?.paths).toEqual([join(dir, IS_WIN32 ? 'probe.cmd' : 'probe')])
  })

  it('keeps request order and skips duplicate names', async () => {
    const dir = await makeDirWith('dup')
    const probes = await ToolEnvInspect.resolveCommands(['missing-cmd', 'probe', 'probe'], envWith(dir))
    expect(probes.map(probe => probe.command)).toEqual(['missing-cmd', 'probe'])
  })

  it('orders matches by PATH directory order', async () => {
    const first = await makeDirWith('first')
    const second = await makeDirWith('second')
    const probes = await ToolEnvInspect.resolveCommands(['probe'], envWith(first, second))
    expect(probes[0]?.paths).toEqual([
      join(first, IS_WIN32 ? 'probe.cmd' : 'probe'),
      join(second, IS_WIN32 ? 'probe.cmd' : 'probe'),
    ])
  })

  it.skipIf(IS_WIN32)('rejects a non-executable file on POSIX', async () => {
    const dir = await makeDirWith('noexec', 0o644)
    const probes = await ToolEnvInspect.resolveCommands(['probe'], envWith(dir))
    expect(probes[0]?.paths).toEqual([])
  })

  it.skipIf(!IS_WIN32)('appends PATHEXT suffixes to a bare command name', async () => {
    const dir = await makeDirWith('extless')
    const probes = await ToolEnvInspect.resolveCommands(['probe'], envWith(dir))
    expect(probes[0]?.paths).toEqual([join(dir, 'probe.cmd')])
  })

  it.skipIf(!IS_WIN32)('treats a request already carrying an executable extension as exact', async () => {
    const dir = await makeDirWith('exact')
    const probes = await ToolEnvInspect.resolveCommands(['probe.cmd'], envWith(dir))
    expect(probes[0]?.paths).toEqual([join(dir, 'probe.cmd')])
  })
})

/** A fake approval service that answers every request with the scripted outcome and records the asks. */
function fakeApproval(answers: ApprovalOutcome[], asks: ApprovalRequest[] = []): unknown {
  return {
    async request(req: ApprovalRequest): Promise<ApprovalOutcome> {
      asks.push(req)
      return answers.shift() ?? 'unavailable'
    },
  }
}

/** A fake subprocess service resolving to a stub path and yielding a scripted spawn handle. */
function fakeSubprocess(executable: string, outcome: SubprocessOutcome, stdout = ''): unknown {
  return {
    async resolveExecutable(name: string): Promise<string> {
      if (name === 'missing-probe') throw new Error('not found')
      return executable
    },
    spawn(_spec: SubprocessSpawnSpec): SubprocessHandle {
      return {
        collected: { stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) } },
        done: Promise.resolve(outcome),
      } as unknown as SubprocessHandle
    },
  }
}

async function setup(
  maxCommands = 8,
  options: { approval?: unknown; subprocess?: unknown; shell?: unknown; apps?: Partial<ToolEnvInspect.AppsInspectConfig> } = {},
): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  ctx.provide('approval', options.approval ?? fakeApproval([]))
  ctx.provide('subprocess', options.subprocess ?? fakeSubprocess('stub-path', { exitCode: 0, signal: null }))
  if (options.shell !== undefined) ctx.provide('shell', options.shell)
  context = ctx
  await ctx.plugin(ToolEnvInspect, {
    maxCommands,
    versionMaxCommands: 4,
    versionTimeoutMs: 5000,
    appsDefaultLimit: 20,
    appsMaxLimit: 50,
    appsCacheTtlMs: 0,
    appsTimeoutMs: 15000,
    ...options.apps,
  })
  return ctx
}

describe('env_inspect tool', () => {

  let agentCounter = 0

  function agent(ctx: Context): Agent {
    const scope = ctx.plugin(() => {})
    const id = SessionId(`env-inspect-agent-${++agentCounter}`)
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

  function call(ctx: Context, commands: string[]) {
    return ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('env'),
      name: 'env_inspect',
      arguments: { commands },
      agent: agent(ctx),
    })
  }

  it('answers every requested command with its PATH resolution', async () => {
    const dir = await makeDirWith('tool')
    vi.stubEnv('PATH', dir)
    const ctx = await setup()
    const result = await call(ctx, ['probe', 'definitely-missing-cmd'])
    expect(result.isError).toBe(false)
    const text = resultText(result)
    expect(text).toContain(`probe: ${join(dir, IS_WIN32 ? 'probe.cmd' : 'probe')}`)
    expect(text).toContain('definitely-missing-cmd: not found')
  })

  it('rejects a call beyond the configured bound', async () => {
    const ctx = await setup(2)
    const result = await call(ctx, ['a', 'b', 'c'])
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('at most 2 distinct commands')
  })

  it('rejects paths and blank names', async () => {
    const ctx = await setup()
    for (const bad of [['./probe'], ['C:\\probe'], ['']]) {
      const result = await call(ctx, bad)
      expect(result.isError).toBe(true)
    }
  })

  it('unregisters the tools when their contributing fiber is disposed (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    ctx.provide('approval', fakeApproval([]))
    ctx.provide('subprocess', fakeSubprocess('stub-path', { exitCode: 0, signal: null }))
    context = ctx
    const fiber = await ctx.plugin(ToolEnvInspect, {
      maxCommands: 8,
      versionMaxCommands: 4,
      versionTimeoutMs: 5000,
      appsDefaultLimit: 20,
      appsMaxLimit: 50,
      appsCacheTtlMs: 0,
      appsTimeoutMs: 15000,
    })
    expect(ctx.tools.schemas().some(s => s.name === 'env_inspect')).toBe(true)
    expect(ctx.tools.schemas().some(s => s.name === 'env_version')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'env_inspect')).toBe(false)
    expect(ctx.tools.schemas().some(s => s.name === 'env_version')).toBe(false)
  })
})

describe('env_version tool', () => {
  let agentCounter = 0

  function agent(ctx: Context): Agent {
    const scope = ctx.plugin(() => {})
    const id = SessionId(`env-version-agent-${++agentCounter}`)
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

  function call(ctx: Context, commands: string[]) {
    return ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('env-version'),
      name: 'env_version',
      arguments: { commands },
      agent: agent(ctx),
    })
  }

  function callWithoutAgent(ctx: Context, commands: string[]) {
    return ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('env-version'),
      name: 'env_version',
      arguments: { commands },
    })
  }

  it('reports the approved child version with its resolved path', async () => {
    const asks: ApprovalRequest[] = []
    const ctx = await setup(8, {
      approval: fakeApproval(['allowed-once'], asks),
      subprocess: fakeSubprocess('C:/stub/git.exe', { exitCode: 0, signal: null }, 'git version 2.45.0\n'),
    })
    const result = await call(ctx, ['git'])
    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('git: git version 2.45.0 (C:/stub/git.exe)')
    expect(asks).toHaveLength(1)
    expect(asks[0]?.toolName).toBe('env_version')
    expect(asks[0]?.reason).toContain('git.exe')
  })

  it('answers not found without asking for approval', async () => {
    const asks: ApprovalRequest[] = []
    const ctx = await setup(8, {
      approval: fakeApproval(['allowed-once'], asks),
      subprocess: fakeSubprocess('stub', { exitCode: 0, signal: null }),
    })
    const result = await call(ctx, ['missing-probe'])
    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('missing-probe: not found')
    expect(asks).toHaveLength(0)
  })

  it('denies a probe whose approval decision is not an allow', async () => {
    for (const outcome of ['rejected', 'unavailable'] as const) {
      const ctx = await setup(8, {
        approval: fakeApproval([outcome]),
        subprocess: fakeSubprocess('stub', { exitCode: 0, signal: null }),
      })
      const result = await call(ctx, ['git'])
      expect(result.isError).toBe(false)
      expect(resultText(result)).toContain(`git: denied by approval decision (${outcome})`)
    }
  })

  it('reports a nonzero child exit with its stderr and an empty run', async () => {
    const ctx = await setup(8, {
      approval: fakeApproval(['allowed-once', 'allowed-once']),
      subprocess: fakeSubprocess('stub', { exitCode: 3, signal: null }),
    })
    const failed = await call(ctx, ['git'])
    expect(resultText(failed)).toContain('git: exited with code 3')
    const ctx2 = await setup(8, {
      approval: fakeApproval(['allowed-once']),
      subprocess: fakeSubprocess('stub', { exitCode: 0, signal: null }, ''),
    })
    const empty = await call(ctx2, ['git'])
    expect(resultText(empty)).toContain('git: (no output) (stub)')
  })

  it('rejects a call beyond the configured version bound and path-shaped names', async () => {
    const ctx = await setup(8, {
      approval: fakeApproval([]),
      subprocess: fakeSubprocess('stub', { exitCode: 0, signal: null }),
    })
    const result = await call(ctx, ['a', 'b', 'c', 'd', 'e'])
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('at most 4 distinct commands')
    for (const bad of [['./git'], ['']]) {
      const badResult = await call(ctx, bad)
      expect(badResult.isError).toBe(true)
    }
  })

  it('requires an owning agent so approvals land in a session audit log', async () => {
    const ctx = await setup(8, {
      approval: fakeApproval([]),
      subprocess: fakeSubprocess('stub', { exitCode: 0, signal: null }),
    })
    const result = await callWithoutAgent(ctx, ['git'])
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('owning agent session')
  })
})
