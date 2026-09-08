# Agent Note: Todo items carry completion evidence

Status: implemented

English | [中文](2026-09-05-todo-evidence.zh.md)

## Problem

The plan's task-orchestrator model requires evidence for each completed step. The todo list — the agent's durable task surface — recorded only `content` plus a three-state `status`, so a `completed` entry could not distinguish "I believe this is done" from "this was verified", and a resumed session had no record of which steps had proof. This extends the original minimal item shape ([todo write tool](2026-06-29-todo-write-tool.md)) with its one optional field.

## Decision

`TodoItem` gains an optional `evidence` line: the check that passed or the artifact that proves a completed task. The tool description invites the model to attach it on `completed` items; execution trims it, rejects empty lines, and rejects evidence on a non-completed item. The durable invariant validates its shape (present means a non-empty trimmed string) and deliberately stays silent on which statuses may carry it — the same replay-compatibility rule as the parallel in-progress policy, so logs written under one policy replay under another. The `todos` projection schema accepts the field and bumps `stateVersion` to 3.

Enforcement is a required deployment choice, not a coded rule: `requireCompletedEvidence` (no default, misconfiguration fails at load) follows the `allowParallelInProgress` pattern. `true` turns the invitation into a gate — the description demands the proof line and a completed item without one is rejected — while `false` keeps the invitation. Shipped profiles choose `false`, which leaves the model-visible description of every shipped composition unchanged; a deployment that wants the discipline flips the flag.

## Alternatives considered

**Enforcement on by default in shipped profiles.** Rejected: requiring evidence on every completed todo — including trivial checklist items — would change the model-visible contract of every shipped composition and force models to invent proof lines; the discipline belongs to deployments that want it.

**A fourth `verified` status.** Rejected: the three statuses are the documented portable lifecycle; a fourth state would teach every model, UI, and SDK consumer a new word for what an evidence line already says.

**Evidence as a separate session event.** Rejected: whole-list replacement is the write model — evidence that must survive replacement belongs on the entry itself.

## Consequences

Completed todos can now carry their proof through the log, projection, and SDK surfaces, and resumed sessions see which steps were verified. Deployments opt into enforcement with `requireCompletedEvidence: true`; either setting replays history written under the other. The recorded-session snapshot sidecars (tool schemas and system prompts) were refreshed for the new model-visible schema and description; on Windows the refresh harness writes with a broken encoding and platform-divergent toolsets, so the sidecars were updated by a UTF-8 batch transform instead and remain to be re-validated by the Linux snapshot lane.
