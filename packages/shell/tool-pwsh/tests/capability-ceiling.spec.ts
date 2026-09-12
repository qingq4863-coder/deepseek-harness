/**
 * Capability-ceiling proof for the shipped command-execution tools: a preset
 * that declares `capabilityRisk` admits `pwsh` at its declared risk, denies it
 * below that risk naming what it declared, and still fails closed for an
 * undeclared tool — while a preset without a ceiling keeps executing it. The
 * registry, the sandbox policy, and the preset service are real; the executor
 * is a confining fake, because the ceiling decides before dispatch and no path
 * here needs a real command.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import * as ToolPwsh from '@deepseek-ai/dsh-tool-pwsh'
import * as BashEnvPlugin from '@deepseek-ai/dsh-shell-env'

const signal = new AbortController().signal

/** A tool that declares nothing, so a ceilinged preset must refuse it. */
const unsignedProbe = defineTool({
  name: 'unsigned-probe',
  description: 'probe without capability metadata',
  parameters: {},
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  async execute() { return 'ran' },
})

/** The one successful command result the fake executor returns; nothing spawns. */
const ranCommand: ShellRunResult = {
  exitCode: 0,
  signal: null,
  timedOut: false,
  aborted: false,
  timeoutMs: 1000,
  stdout: { text: 'ok', truncated: false },
  stderr: { text: '', truncated: false },
}

/**
 * A confining executor (it advertises a sandbox mode, which the preset service
 * requires) whose run never spawns, so the ceiling is the only decision under
 * test.
 */
class FakeExecutor extends ShellExecutor {
  override get sandboxMode() {
    return 'workspace-write' as const
  }

  override resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? process.cwd(),
      timeoutMs: request.timeoutMs ?? 60_000,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
      ...request.signal ? { signal: request.signal } : {},
      ...request.dshEnv !== undefined ? { dshEnv: request.dshEnv } : {},
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  override run(): Promise<ShellRunResult> {
    return Promise.resolve(ranCommand)
  }

  override start(): ShellProcess {
    throw new Error('capability tests do not start background processes')
  }
}

let ctx: Context
let callCounter = 0

afterEach(async () => {
  await ctx.fiber.dispose()
})

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  // The loop's turnBoundary fold is where the approval audit pair's turn
  // enclosure is read from; the loop itself is not composed here.
  ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(BashEnvPlugin, {})
  await ctx.plugin(SandboxPolicyService, {})
  await ctx.plugin(FakeExecutor)
  await ctx.plugin(ApprovalService)
  await ctx.plugin(ToolPwsh)
  ctx.tools.register(unsignedProbe)
  await ctx.plugin(PermissionPresetService, {
    presets: {
      'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
      high: { sandbox: 'workspace-write', approval: 'ask', capabilityRisk: 'high' },
      medium: { sandbox: 'workspace-write', approval: 'ask', capabilityRisk: 'medium' },
    },
    defaultPreset: 'workspace-write',
  })
})

/** Create one real session and select its preset. */
function agentUnder(preset: 'workspace-write' | 'high' | 'medium'): Agent {
  const session = Session.create(SessionId(`sess-pwsh-ceiling-${preset}`))
  const agent = { session } as unknown as Agent
  ctx.permissionPresets.set(session, preset)
  return agent
}

/** Execute one tool under an agent whose preset declares (or omits) a ceiling. */
function call(name: string, args: unknown, agent: Agent) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`call-${++callCounter}`),
    name,
    arguments: args,
    agent,
  })
}

/** Concatenated model-facing text of one result. */
function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('preset capability ceiling over the shipped command-execution tools', () => {
  it('admits the command tool under a ceiling at its declared risk', async () => {
    const result = await call('pwsh', { command: 'Write-Output ok', description: 'Echo ok' }, agentUnder('high'))

    expect(result.isError).toBe(false)
    expect(text(result)).toContain('ok')
  })

  it('still executes the command tool under a preset that declares no ceiling', async () => {
    const result = await call('pwsh', { command: 'Write-Output ok', description: 'Echo ok' }, agentUnder('workspace-write'))

    expect(result.isError).toBe(false)
    expect(text(result)).toContain('ok')
  })

  it('denies the command tool whose declared risk exceeds a lower ceiling', async () => {
    const result = await call('pwsh', { command: 'Write-Output ok', description: 'Echo ok' }, agentUnder('medium'))

    expect(result.isError).toBe(true)
    expect(text(result)).toBe('Error: tool "pwsh" risk "high" exceeds the "medium" capability ceiling of preset "medium"')
  })

  it('still refuses a tool that declares no capability metadata', async () => {
    const result = await call('unsigned-probe', {}, agentUnder('high'))

    expect(result.isError).toBe(true)
    expect(text(result)).toBe('Error: tool "unsigned-probe" declares no capability metadata, which preset "high" requires')
  })
})
