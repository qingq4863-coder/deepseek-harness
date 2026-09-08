# Agent Note: Version probing gates execution behind one-shot approvals

Status: implemented

English | [中文](2026-09-07-env-version.zh.md)

## Problem

The read-only `env_inspect` slice answers "is it installed?" but not "will it work?": the model still cannot ground a version requirement (`git >= 2.30`, a Python minor) in a real answer. Running `<cmd> --version` is execution — the exact surface the first slice deliberately kept out — so it needed its own decision about who says yes.

## Decision

`env_version` joins `@deepseek-ai/dsh-experimental-tool-env-inspect` as the package's one execution surface. Per command, it resolves the executable through the subprocess seam, asks `ctx.approval.request` for a one-shot decision naming the exact `"<path>" --version` run, and only an `allowed-once` outcome runs the child: a bounded `--version` spawn with a `versionTimeoutMs` deadline, tree-scoped abort, and fixed 4096-byte stdout/stderr capture. Every non-allow outcome — a `never` session policy, a missing or throwing answerer, a cancellation — becomes a `denied by approval decision` probe entry, so the tool fails closed exactly like the approval subsystem does. The package now injects `approval` and `subprocess` declaratively: a composition that omits either service fails at injection instead of getting a silently weakened tool.

The three bounds (`maxCommands`, `versionMaxCommands`, `versionTimeoutMs`) stay required with no default — the todo tool's explicit-choice pattern — and misconfiguration fails at load. The package publishes no `./invariant` companion: approval auditing is owned by `dsh-user-approval`'s invariant, and the probes add no durable state of their own.

## Alternatives considered

**A `versions: true` flag on `env_inspect`.** Rejected: it would hide that flipping the flag turns a read-only tool into an executor, and the approval seam requires a real Agent turn — a shape the read-only tool deliberately does not need. A separate tool keeps the trust boundary visible in the model's tool list.

**Resolving through the shell (`cmd --version` composed into a bash call).** Rejected: the bash tool exists, but its command string is free-form prose, not a per-probe approval with the exact executable named in the decision reason; the model would also have to guess platform resolution it already gets from `env_inspect`.

**Making the output cap a config field.** Deferred: 4096 bytes is a fixed result contract for version banners, not a deployment-varying choice; revisit only if a real program's banner is provably cut off.

## Consequences

Deployments that mount the package get grounded version answers with the exact executable path, and every run is attributable to a logged `approval/asked` + `approval/decided` pair. The real composition test runs the host's own `node --version` through the local subprocess provider and proves the no-answerer fail-closed path; a `never` policy is covered by the approval subsystem's own suite. The installer plan's next slices — an installed-program inventory beyond `PATH`, then download/verify/install — each widen the approval question and should land separately.
