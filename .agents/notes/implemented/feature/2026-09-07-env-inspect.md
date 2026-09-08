# Agent Note: Read-only environment inspection comes first

Status: implemented

English | [中文](2026-09-07-env-inspect.zh.md)

## Problem

The plan's installer and environment manager flow starts with inspecting machine state, and its first success criterion is "inspect whether an application or dependency is installed." The harness had no semantic surface for that: the model could only guess platform commands (`where`, `which`, `Get-Command`) through the shell, and a wrong guess wasted a turn and could not be grounded in structured state.

## Decision

`@deepseek-ai/dsh-experimental-tool-env-inspect` ships the `env_inspect` tool: bare command names in, one `{ command, paths }` probe per name out, ordered by `PATH`. Resolution runs in-process against the filesystem — `stat`/`access`, never execution — so the tool adds no approval surface beyond the tool call itself and Windows `PATHEXT` and POSIX executable-bit semantics both hold. The per-call command bound is a required `maxCommands` config (1-64, misconfiguration fails at load), following the todo tool's required-choice pattern. The package publishes no `./invariant` companion because it owns no durable state: a pure query has no durable invariant whose independent observations can diverge.

The package lives under `packages/experimental/` on purpose: it is excluded from official releases, no shipped profile mounts it, and the recorded-session snapshot surface is unchanged. A deployment opts in by adding the entry to its cordis.yml.

## Alternatives considered

**Resolving through the shell (`where`/`which`).** Rejected: the semantics differ per platform and per shell, the result is prose rather than structured paths, and a shell call is an execution surface where a read-only lookup needs none.

**Including version probing in the first slice.** Deferred, then shipped separately: `--version` runs the found program — an execution surface that belongs behind the approval gating documented in [env version](2026-09-07-env-version.md); the read-only slice landed without it.

**Mounting in shipped profiles now.** Deferred: the tool is useful without an installer flow behind it, but the approval policy for the later install slice should decide how the whole family is exposed, not just the lookup.

## Consequences

Compositions that mount the tool get grounded yes/no answers with the exact executable path, and the model stops guessing platform commands. Version probing has since joined the package as its gated execution surface ([env version](2026-09-07-env-version.md)); the remaining installer-plan slices — an installed-program inventory beyond `PATH` and the propose-confirm-install-verify flow — each add an execution or mutation surface and should land as their own slices with their own approval gating. The experimental location is temporary: promotion follows the same rules as any package, once a stable owner and a real composition consumer exist.
