# Agent Note: A denial budget stops automatic goal continuation

Status: implemented

English | [中文](2026-09-12-goal-approval-denial-stop.zh.md)

## Problem

§4.3 of the evolution plan lists `maxApprovalDenials` (default 2) beside `maxAttempts` and `maxConsecutiveFailures`, with the rule it exists for: a denied request is not re-issued in a different form. The [same-session driver](2026-07-19-same-session-goal-round-driver.md) already stops a goal whose tool calls keep failing, but a goal can also fail by being *refused*: the model proposes a gated action each round, the user denies it, and the driver continues anyway, spending its remaining round cap on requests the human already rejected. Nothing observed the approval decision, so the goal could not stop for a reason the user had already given.

The denial input is not the tool result. It is the durable `approval/decided` event, which `dsh-user-approval` declares. The [failure-streak stop](2026-09-10-goal-consecutive-failure-stop.md) read the `tool/result` result block's `isError` and needed no cross-package dependency, so counting denials inside `dsh-goal-round-driver` adds one.

## Decision

`dsh-goal-round-driver` counts user-rejected approvals and stops automatic continuation at `maxApprovalDenials`.

The counter increments only when an `approval/decided` session event carries outcome `rejected` while the driver's own reserved round for that session is in the `admitted` phase. The other outcomes and states are deliberately excluded: `cancelled` is a withdrawn question, `unavailable` is the fail-closed answerer rather than a human decision, and a decision taken during a human turn belongs to work the human drove. The gate sits at the continuation decision beside the failure streak and the round cap, so the goal is blocked before the next round is reserved, with the stable code `approval-denials` and a message naming the count. The `approval/asked` + `approval/decided` audit pairs remain in the session log as the rejected decisions the blocker refers to, and the driver quotes no decision text of its own. A stop never re-asks: the driver neither retries the denied call nor restates it in another form.

`maxApprovalDenials` is a validated plugin config field with a declared default of 2, in the shape `maxConsecutiveFailures` already uses: an optional schemastery field with a default plus a fail-loud re-check for direct `apply` calls. It belongs to the driver for the same reason the failure bound does — the driver decides whether to continue, and a deployment value the model cannot reach is a safer ceiling than a per-goal number the model could widen.

The count is process-local scheduling state, like the rest of the driver's state, and resets on the same observations as the failure streak: a human-authorized `resume`, a new goal (`create`), and a new session start. It deliberately does not reset on a successful tool result, unlike the streak, because one permitted action does not make the refused ones acceptable.

## Alternatives considered

**Extend the failure-streak note to cover both stops.** Rejected: the two answer different questions with different inputs (a tool result block versus the approval seam's durable outcome) and different reset rules. One note would have forced one rationale onto two decisions. The two notes are cross-linked instead, and the dependency the failure note declined to take is taken here.

**Count every `approval/decided` outcome except `allowed-once`.** Rejected: that would let the fail-closed `unavailable` answerer — a configuration fact, not a human refusal — and a withdrawn request stop a goal, and the blocker would then claim a user denial that never happened. Only `rejected` is a decision.

**Count denials from any turn in the session.** Rejected: the stall case is a goal round that keeps proposing refused work. A denial during a human turn is that human's own troubleshooting, and it must not disarm an armed goal they left running.

**Count in a `session/event` listener that appends a durable stop event.** Rejected for the reason the failure streak records: appending a session event from inside a session listener has no precedent here, and the transition already has an owner — the driver commits the goal state at its continuation gate.

**Put the bound on the goal definition as `maxGoalRounds` is.** Rejected: the goal's own fields are durable replay state, so a new one must be added to the fold's exact-key decoder, the projection schema, the snapshot type, and the `GoalView` DTO that crosses the Typert Remote, and it would let a model widen its own stop bound at creation time.

**Ask again, then retry the denied call.** Rejected: §4.3 states that a denied request is not re-issued in a different form, and this package already documents that it has no abnormal auto-retry. The stop is the answer.

## Consequences

A goal now stops for a second human-given reason, and the blocker names it: the code carries the count and the log holds the ask/outcome pairs, so a reader can see which requests were refused. Because the stop disarms the goal, the model cannot restart it in the same turn, and the resume that follows starts from a clean count instead of immediately re-blocking on the denials that stopped it.

The cost is one cross-package type dependency: `dsh-goal-round-driver` declares `@deepseek-ai/dsh-user-approval` as a peer and dev dependency for the `ApprovalOutcome` vocabulary and the `approval/decided` session event. The import is type-only and the driver reads an event that any mounted approval seam already appends, so the driver still runs in a composition without `dsh-user-approval` and simply observes no denials. The unit suite covers the threshold with the real approval service under its deterministic `never` policy, a configured threshold of 1, the resume reset, the `unavailable` outcome that must not count, and the invalid direct config.
