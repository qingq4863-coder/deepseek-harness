# Agent Note: Installation verification compares named inventory snapshots

Status: implemented

English | [中文](2026-09-09-apps-snapshot-diff.zh.md)

## Problem

`apps_inspect` answers what is installed right now, but the installer plan's verification step needs to prove what an installation changed. Re-reading the inventory after the fact and describing the difference from memory produces a reconstructed claim, not evidence; the plan's observation section calls for named snapshots and a direct diff instead.

## Decision

`apps_snapshot` and `apps_diff` join the package as read-only Consumers over the same fixed collection script. `apps_snapshot` asks for one approval decision, reads the inventory, and stores the complete unfiltered entry set under a validated name in the composition's memory; the store keeps at most `appsMaxSnapshots` captures, a same-named capture replaces its predecessor, and the oldest is evicted past the bound. A capture whose sources were all unread is refused instead of stored, because an empty baseline would later report every entry as added.

`apps_diff` matches entries by their stable source-keyed id, so a renamed application is one `changed` entry rather than an add plus a remove, and reports `added`, `removed`, and per-field `changed` rows for the compared fields (name, version, publisher, install location). It compares a stored snapshot against the machine now — one approval decision, reusing the inventory cache — or against another stored snapshot, which reads nothing and therefore asks for nothing. Both results carry each observation's source reports and a `coverageChanged` flag; when the two observations did not cover the same sources, the render says so, because an entry can then appear added or removed without the machine changing. The store is session-owned and not durable: the captures belong to the session that made them, a second session in the same composition cannot read them, and `apps_diff` fails loud for an unknown name rather than comparing against nothing.

## Alternatives considered

**Durable session events for snapshots.** Deferred: it would make captures survive a restart, but the entry set is machine-sensitive metadata and would then sit in the session log; the model-visible diff is already logged as a tool result, and a later slice can add durability with its own retention rules.

**Matching entries by display name.** Rejected: names are mutable and collide across products, which would turn one rename into a spurious add plus remove.

**Capturing a baseline automatically on every `apps_inspect` call.** Rejected: implicit state makes the diff depend on call history the model did not declare; an explicit name keeps the baseline visible in the log.

## Consequences

The install flow can capture a baseline, perform its approved change, and diff the machine against that baseline with direct evidence naming what changed. Coverage differences are reported rather than silently attributed to the machine, and the adversarial cases pin the diff's identity rule, the refusal to store an unread baseline, the bounded store, and the no-read path between two stored snapshots. Snapshots are lost on a host restart and the store is bounded; both facts are stated in the package README's limitations.
