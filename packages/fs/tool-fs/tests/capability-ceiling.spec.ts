/**
 * Capability-ceiling proof for the shipped filesystem tools: a preset that
 * declares `capabilityRisk` admits the declared tool at or below its ceiling,
 * denies a declared tool above it, and still fails closed for an undeclared one.
 * The filesystem stack, the registry, and the preset service are real; only the
 * shell and approval services are stubs, because no path here executes a shell.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'

const signal = new AbortController().signal

/** A tool that declares nothing, so a ceilinged preset must refuse it. */
const unsignedProbe = defineTool({
  name: 'unsigned-probe',
  description: 'probe without capability metadata',
  parameters: {},
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  async execute() { return 'ran' },
})

let dir: string
let ctx: Context
let callCounter = 0

afterEach(async () => {
  await ctx.fiber.dispose()
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-tool-fs-ceiling-'))
  ctx = new Context()
  // The policy deployment is the real one: the shipped tools are registered
  // exactly as a profile mounts them.
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  await ctx.plugin(FsPolicy)
  await ctx.plugin(ToolFs)
  ctx.tools.register(unsignedProbe)
  // No sandbox policy is mounted, so the workspace-write preset still runs the
  // unrestricted default path; the assertion never depends on a promoted ask.
  ctx.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('capability tests do not execute a shell') },
    run() { throw new Error('capability tests do not execute a shell') },
    start() { throw new Error('capability tests do not execute a shell') },
  })
  ctx.provide('approval', { config: { policy: 'ask' } })
  await ctx.plugin(PermissionPresetService, {
    presets: {
      'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
      medium: { sandbox: 'workspace-write', approval: 'ask', capabilityRisk: 'medium' },
      low: { sandbox: 'workspace-write', approval: 'ask', capabilityRisk: 'low' },
    },
    defaultPreset: 'workspace-write',
  })
})

/** Create one real session and select its preset. */
function agentUnder(preset: 'medium' | 'low'): Agent {
  const session = Session.create(SessionId(`sess-ceiling-${preset}`))
  const agent = { session } as unknown as Agent
  ctx.permissionPresets.set(session, preset)
  return agent
}

/** Execute one tool under an agent whose preset declares a ceiling. */
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

describe('preset capability ceiling over the shipped filesystem tools', () => {
  it('admits the low-risk read tool under a medium ceiling', async () => {
    await writeFile(join(dir, 'readable.txt'), 'line one\nline two\n')
    const agent = agentUnder('medium')

    const result = await call('read', { file_path: 'readable.txt' }, agent)

    expect(result.isError).toBe(false)
    expect(text(result)).toContain('line one')
  })

  it('still refuses a tool that declares no capability metadata', async () => {
    const result = await call('unsigned-probe', {}, agentUnder('medium'))

    expect(result.isError).toBe(true)
    expect(text(result)).toBe('Error: tool "unsigned-probe" declares no capability metadata, which preset "medium" requires')
  })

  it('denies the write tool whose declared risk exceeds a low ceiling', async () => {
    const result = await call('write', { file_path: 'denied.txt', content: 'never written' }, agentUnder('low'))

    expect(result.isError).toBe(true)
    expect(text(result)).toBe('Error: tool "write" risk "medium" exceeds the "low" capability ceiling of preset "low"')
    await expect(readFile(join(dir, 'denied.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
