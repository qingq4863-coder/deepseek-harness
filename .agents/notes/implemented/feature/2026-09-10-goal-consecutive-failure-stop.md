# Agent Note: A consecutive-failure streak stops automatic goal continuation

Status: implemented

English | [中文](2026-09-10-goal-consecutive-failure-stop.zh.md)

## Problem

§4.3 of the evolution plan asks for a stop threshold per goal: `maxConsecutiveFailures` (default 3) alongside `maxAttempts` and `maxApprovalDenials`. The [same-session driver](2026-07-19-same-session-goal-round-driver.md) continues an armed goal until its round cap, and nothing observes that the rounds themselves keep failing: a goal whose tool calls fail the same way every round spends its whole cap before it stops, and each round costs a full model turn. The threshold has to stop the goal *before* the next round is reserved, and it must not become a retry policy — the plan and the package both reject automatic retries.

## Decision

`dsh-goal-round-driver` counts consecutive failed tool results and stops automatic continuation at the bound. The failure marker is the `isError` field of the `tool/result` event's result block, not the payload's optional `error`, which carries internal failure identity rather than a model-facing failure.

The count lives in the driver's process-local scheduling state beside its reservation, and it changes on exactly three observations: a failed tool result increments it, a successful tool result resets it to zero, and a human-authorized `resume` resets it. A new session start resets it too. The gate is evaluated in the same place as the round cap — at the continuation decision, before a round is reserved — and it blocks the goal with the stable code `consecutive-failures` and a message naming the streak. The failed calls stay in the session log, which is the failure list the blocker refers to; the driver quotes no error text of its own.

`maxConsecutiveFailures` is a validated plugin config field with a declared default of 3, in the shape `dsh-tool-goal` already uses for its own threshold: an optional schemastery field with a default plus a fail-loud re-check for direct `apply` calls. The bound belongs to the driver rather than to the goal definition because it governs the continuation decision, and because a deployment value the model cannot reach is a safer ceiling than a per-goal number the model could widen.

## Alternatives considered

**Add the threshold to the goal definition as `maxGoalRounds` is.** Rejected: the goal's own fields are durable replay state, so a new one must be added to the fold's exact-key decoder, the projection schema, the snapshot type, and the `GoalView` DTO that crosses the Typert Remote. That is a large, replay-format-affecting change for a value the goal never reads, and it would let a model widen its own stop bound at creation time.

**Count in a `session/event` listener that appends a durable stop event.** Rejected in the reconnaissance recorded in the plan: appending a session event from inside a session listener has no precedent here, and the transition has an owner already — the driver commits the goal state at its continuation gate, exactly as it does for `round-limit`.

**Reset the streak when a goal round starts.** Rejected: the case worth catching is a goal that burns several rounds failing once each, and a per-round reset would only see failures inside one round.

**Count only failures that occur inside an admitted goal round.** Rejected as unnecessary: a streak can only act at a continuation gate, and the only ways to reach one with an armed goal are continued automatic driving or a human resume, which resets the count. The simpler session-wide count therefore cannot stop a goal because of unrelated human-turn failures that a human did not already authorize past.

**Retry the failed call instead of stopping.** Rejected: the plan's stop threshold exists to bound autonomous work, and this package documents that it has no abnormal auto-retry. The driver stops and disarms; a human resume is the only continuation path.

**Reuse `dsh-tool-goal`'s `blockedAfterConsecutiveRounds`.** Rejected: that threshold is model-facing policy — it refuses a model's own `blocked` claim before enough rounds have passed — and it counts rounds, not failures. The two answer different questions and stay in their own packages.

## Consequences

A goal now stops with the reason a human needs to judge it: the code says the streak, and the log holds the calls. Because the stop disarms the goal, the model cannot restart it in the same turn, and the resume that follows starts from a clean count instead of re-blocking on the streak that stopped it.

The counter is process-local, like the rest of the driver's scheduling state, so a host restart re-derives it from the next tool results rather than replaying it; the durable record of the stop is the goal's blocker, which replays exactly. The unit suite covers the threshold with the real agent loop, a failing fixture tool, and a succeeding one: the streak stop, a success that interrupts it, a configured threshold of 2, the resume reset, the invalid direct config, and a direct `apply` that resolves the default. `maxApprovalDenials` from the same plan paragraph remains unimplemented: its input is `approval/decided`, which `dsh-user-approval` declares, so counting it inside the driver would add a cross-package type dependency that the `tool/result` marker did not need.
