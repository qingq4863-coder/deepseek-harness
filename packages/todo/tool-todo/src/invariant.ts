/** Package-owned durable todo-snapshot invariants. @module @deepseek-ai/dsh-tool-todo/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-todo'
const TODO_STATUSES = new Set(['pending', 'in_progress', 'completed'])

/** Cordis companion plugin name. */
export const name = 'tool-todo-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate one whole-list todo snapshot before it reaches the durable log.
 *
 * Deliberately silent on how many items are `in_progress`, and on whether
 * `evidence` belongs on a `completed` item. Both are the tool's per-deployment
 * policy, not durable-shape rules: a log written under one policy must still
 * replay after a deployment tightens it, so tying the invariant to the current
 * config would reject history that was valid when it was written.
 */
function validateTodos(value: unknown, fail: InvariantFailure): void {
  if (!Array.isArray(value)) fail('todo/write todos must be an array')
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'object' || item === null) fail('todo/write entries must be objects')
    const { content, status, evidence } = item as Record<string, unknown>
    if (typeof content !== 'string' || content.length === 0 || content.trim() !== content) {
      fail('todo/write content must be non-empty and already trimmed')
    }
    if (seen.has(content)) fail(`todo/write repeats content ${JSON.stringify(content)}`)
    seen.add(content)
    if (typeof status !== 'string' || !TODO_STATUSES.has(status)) {
      fail(`todo/write carries unknown status ${JSON.stringify(status)}`)
    }
    if (evidence !== undefined
      && (typeof evidence !== 'string' || evidence.length === 0 || evidence.trim() !== evidence)) {
      fail('todo/write evidence must be a non-empty and already trimmed string when present')
    }
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Incremental turn state for one committed session log. */
interface TurnTrace {
  open: boolean
}

/** Advance the trace after one event has committed. */
function advanceTrace(trace: TurnTrace, event: SessionEvent): void {
  if (event.type === 'turn/start') trace.open = true
  if (event.type === 'turn/end') trace.open = false
}

/** Validate one package-owned event against the preceding committed trace. */
function validateEvent(event: SessionEvent, trace: TurnTrace, fail: InvariantFailure): void {
  if (event.type !== 'todo/write') return
  validateTodos(event.data.todos, fail)
  if (!trace.open) fail('todo/write appended outside any open turn')
}

/** Validate one existing log in a single pass and return its tail trace. */
function seedTrace(session: Session, fail: InvariantFailure): TurnTrace {
  const trace: TurnTrace = { open: false }
  for (const event of session.snapshotEvents()) {
    validateEvent(event, trace, fail)
    advanceTrace(trace, event)
  }
  return trace
}

/** Install validation for loaded and newly appended whole-list todo snapshots. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const traces = new WeakMap<Session, TurnTrace>()
  const seed = (session: Session): void => {
    traces.set(session, seedTrace(session, fail))
  }
  const traceFor = (session: Session): TurnTrace => {
    let trace = traces.get(session)
    if (trace === undefined) {
      trace = seedTrace(session, fail)
      traces.set(session, trace)
    }
    return trace
  }
  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateEvent(event, traceFor(session), fail)
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    advanceTrace(traceFor(session), event)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the todo invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
