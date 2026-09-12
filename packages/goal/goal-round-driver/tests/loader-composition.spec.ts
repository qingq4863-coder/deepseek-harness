/**
 * Real-composition proof for the goal-round driver: the plugin is mounted
 * through an actual `cordis.yml` document and the Loader, exactly as a profile
 * mounts it, rather than through a hand-built `ctx.plugin(...)` suite. The
 * composition uses the real services; only the model is absent, because what
 * this proves is that the deployment path resolves the driver AND hands it the
 * configured stop policy, not how a model answers.
 */

import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import GoalService from '@deepseek-ai/dsh-goal'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as goalSession from '../src/index.ts'

/** The real modules a test-only composition resolves its rows against. */
const MODULES = new Map<string, unknown>([
  ['@deepseek-ai/dsh-session', SessionStore],
  ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
  ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
  ['@deepseek-ai/dsh-tools', ToolRuntime],
  ['@deepseek-ai/dsh-agent', AgentRegistry],
  ['@deepseek-ai/dsh-goal', GoalService],
  ['@deepseek-ai/dsh-goal-round-driver', goalSession],
])

/** Everything the driver's own rows depend on, in load order. */
const DEPENDENCY_ROWS = [
  "- name: '@deepseek-ai/dsh-session'",
  "- name: '@deepseek-ai/dsh-session-projection'",
  "- name: '@deepseek-ai/dsh-system-prompt'",
  "- name: '@deepseek-ai/dsh-tools'",
  "- name: '@deepseek-ai/dsh-agent'",
  "- name: '@deepseek-ai/dsh-goal'",
]

/** The driver row with its stop policy spelled out, as a deployment writes it. */
function driverRow(config: string[] = []): string[] {
  return ["- name: '@deepseek-ai/dsh-goal-round-driver'", ...config]
}

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(context => context.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** Boot one test-only cordis.yml through the real Loader and await the tree. */
async function boot(rows: string[]): Promise<Context> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-goal-driver-loader-')))
  roots.push(root)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, `${rows.join('\n')}\n`)
  const context = new Context()
  contexts.push(context)
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!MODULES.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return MODULES.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  return context
}

/** An idle agent whose `followup` records every message the driver queues. */
function recordingAgent(ctx: Context, cwd: string): { agent: Agent; queued: UserMessage[] } {
  const id = SessionId('goal-driver-loader-agent')
  const scope = ctx.plugin(() => {})
  // The store owns the session, so the driver's durability checkpoint can flush it.
  const session = ctx.sessions.create(id, { meta: { cwd } })
  const queued: UserMessage[] = []
  const agent = {
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: (message: UserMessage) => { queued.push(message) },
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: (task: (signal: AbortSignal) => Promise<void>) => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  } as unknown as Agent
  ctx.agents.register(agent)
  return { agent, queued }
}

describe('goal-round driver through a real cordis.yml Loader composition', () => {
  it('reserves a goal round for an idle armed goal in the composed tree', async () => {
    const ctx = await boot([...DEPENDENCY_ROWS, ...driverRow()])
    expect(ctx.goals).toBeDefined()
    expect(ctx.agents).toBeDefined()
    const { agent, queued } = recordingAgent(ctx, process.cwd())

    ctx.goals.create(agent, { objective: 'compose through the loader', maxGoalRounds: 4 })

    await vi.waitFor(() => { expect(queued).toHaveLength(1) })
    const goal = ctx.goals.get(agent)
    expect(goal).toMatchObject({ phase: 'active', activation: 'armed', roundsStarted: 0 })
    expect(queued[0]?.source).toMatchObject({ kind: 'goal', round: 1 })
    // The reserved round carries the package-owned prompt, not a re-worded one.
    expect(queued[0]?.content).toEqual(goalSession.renderGoalRoundPrompt(goal!, 1))
  })

  it('accepts the stop policy from the composition document', async () => {
    const ctx = await boot([...DEPENDENCY_ROWS, ...driverRow([
      '  config:',
      '    maxConsecutiveFailures: 5',
      '    maxApprovalDenials: 1',
    ])])
    const { agent, queued } = recordingAgent(ctx, process.cwd())

    ctx.goals.create(agent, { objective: 'compose with a configured policy', maxGoalRounds: 2 })

    await vi.waitFor(() => { expect(queued).toHaveLength(1) })
  })

  it('fails loud when the composition document configures an unusable bound', async () => {
    // The Loader normalizes a row's config through the plugin schema, so this
    // bound is rejected before the driver body runs; the body's own re-check
    // covers a direct `apply`, which the package's unit suite exercises.
    await expect(boot([...DEPENDENCY_ROWS, ...driverRow([
      '  config:',
      '    maxConsecutiveFailures: 5',
      '    maxApprovalDenials: 0',
    ])])).rejects.toThrow(/maxApprovalDenials/)
  })
})
