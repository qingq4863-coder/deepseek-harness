# Agent Note: Retry a failed live session stream on reselection

Status: implemented

English | [中文](2026-09-04-session-stream-reselection.zh.md)

## Problem
A selected session can retain its scope after its live event stream fails. Selecting that same session again leaves the current session id unchanged, so the stage follower does not run and the session remains disconnected from later assistant events.

## Decision
`ClientSessions.open()` performs the normal manager selection and then explicitly follows the current session. The forced follow still uses `Session.open()` idempotency: an open or in-flight stream is unchanged, while a cold or failed stream creates a new event window. Ordinary list-driven follow behavior remains stage-based and does not reopen a healthy stream on repeated notifications.

## Alternatives considered
**Reset the stage before every selection.** This would add teardown and re-open churn for healthy sessions and could discard a frozen scope during transient list masking.

**Retry inside `SessionEventStream` without a new selection signal.** This would change transport failure policy for every consumer and would not address the user action that reselects a session after a stale stream.

## Consequences
Same-session reselection now repairs a failed live stream without affecting healthy streams, deferred scope teardown, persisted selection, or model selection. The behavior is covered by the session-service regression test `reopens a failed live stream when the current session is selected again`; the focused session-controller suite and full workspace build pass. Browser verification against the installed `3080` runtime remains pending because the source checkout has not been deployed there.
