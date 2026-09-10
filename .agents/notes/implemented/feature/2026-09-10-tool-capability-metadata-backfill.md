# Agent Note: Shipped filesystem tools declare their capability metadata

Status: implemented

English | [中文](2026-09-10-tool-capability-metadata-backfill.zh.md)

## Problem

The preset capability ceiling in `dsh-permission-presets` refuses any tool whose `capability.risk` is absent: a ceilinged preset cannot rank what the tool did not declare, so it fails closed. When the ceiling shipped, the only declarations in the tree were the experimental environment tools, which left every shipped tool — including `read` and `write` — refused under any preset that declares `capabilityRisk`, and left no declared risk surface to review for the ones that do not.

## Decision

The shipped filesystem tools declare the complete metadata: `read`, `read_image`, `glob`, and `grep` are `dataClass: 'workspace'`, `risk: 'low'`, `reversible: true`, `approval: 'automatic'`; `write`, `edit`, and `str_replace_editor` are `dataClass: 'workspace'`, `risk: 'medium'`, `reversible: false`, `approval: 'scoped'`.

The classification follows two rules. Risk comes from what the tool can do to the machine, not from how the model is expected to use it: a tool that only reads admitted files stays `low`, and a tool that changes them is `medium` and irreversible, because the harness keeps no undo for a file write even when the tool reports the before/after content. A tool with both read and write commands takes the write-side classification, which is why `str_replace_editor` (`view`, `create`, `str_replace`, `insert`) carries a read scope, a write scope, and the medium risk of its most capable command.

Scopes name the boundary that already governs the tool — "files the filesystem policy admits for this session" — rather than restating a path list that the fs policy owns and can change per call. `approval` stays `automatic` for reads and `scoped` for mutations, which is what those tools already do: the sandbox and permission policy owns the mutation gate, and only the `explicit` and `prohibited` values add a registry-level decision, so no call gains a new prompt from this change.

Every declared field is descriptive: the registry validates the values and the ceiling reads `risk`, while `dataClass`, the scopes, `network`, and `reversible` are for review and for consumers that do not exist yet. Declaring a value never grants authorization.

## Alternatives considered

**Declare every tool `risk: 'high'` so nothing is ever admitted by mistake.** Rejected: a ceiling that refuses everything is the same as no ceiling, and the plan's point is to make deployment ceilings usable by ranking tools honestly.

**Classify `str_replace_editor` as `low` because its common command is `view`.** Rejected: metadata is per tool, not per call, and a ceiling that admits a tool admitting its write command is a false guarantee.

**Give the write tools `approval: 'explicit'` to match the risk.** Rejected: an explicit declaration makes the tool registry prompt for every call, duplicating the approval the sandbox and permission policy already obtains for an out-of-scope write, and turning routine in-workspace edits into prompts. The scoped value states the truth: the existing policy owns that decision.

**Leave the fields that have no consumer unfilled.** Rejected: the metadata is one contract, the validator rejects an incomplete value only by omission rather than by shape, and a reviewer auditing a tool's reach should not have to reconstruct which half of the declaration is real.

## Consequences

A preset that declares `capabilityRisk: 'medium'` now admits the four inspection tools and refuses an undeclared tool with the existing fail-closed message, and a `low` ceiling refuses `write` naming its declared risk. `packages/fs/tool-fs/tests/capability-ceiling.spec.ts` pins all three outcomes against the real registry, real preset service, and the real filesystem stack, mounting only the shell and approval services as stubs; it fails if a declaration is removed, which is what makes it a regression test rather than a restatement.

The remaining shipped tool definitions still declare nothing and still fail closed under a ceiling. Each family classifies the same way: reads at `low` with `automatic` approval, workspace or machine mutation at `medium` or higher with the approval value that matches the gate its policy already applies, and `explicit` reserved for an action whose own confirmation is the gate — the installer tools are the existing example.
