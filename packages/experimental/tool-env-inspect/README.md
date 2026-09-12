---
description: "Experimental model-facing environment tools: PATH and version probing, installed-application inventory, package-manager proposals, and approval-gated install/uninstall."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-env-inspect

English | [中文](README.zh.md)

## Summary

`dsh-experimental-tool-env-inspect` gives the model nine environment tools. `env_inspect` is read-only: it takes a list of command names and answers, for each one, which executable files exist on `PATH` — the first hit is the one a shell would run — or that the command is not installed; resolution runs in-process against the filesystem, so nothing is executed. `env_version` is the package's one per-command execution surface: it resolves each name, asks the approval seam for a one-shot allow/reject decision, and runs the approved executable's `--version` in a time-limited child process with bounded output capture. `apps_inspect` enumerates installed applications from read-only Windows inventory sources — machine and per-user registry uninstall entries, App Paths launch names, and the current user's AppX/MSIX packages — through the optional shell seam; it never runs a discovered program and never returns uninstall commands. `apps_snapshot` captures one bounded, named observation of that inventory, and `apps_diff` compares two observations by stable entry id to report what an installation, update, or removal changed. `pkg_inspect` runs each selected package manager's fixed read-only command behind its own approval decision and reports the packages that manager records, and `pkg_propose` resolves what a manager says about one candidate package before anything is installed. `pkg_install` and `pkg_uninstall` are the package's only machine-mutating surfaces: each runs one fixed package-manager argv behind one explicit approval decision that names the exact resolved command, and each reports what the manager said rather than a verified change. All nine are experimental: excluded from official releases, they carry no stability promise and are mounted only by compositions that explicitly include them. This package is the environment-manager plan's read, probe, propose, install, and verify slices; artifact download and rollback stay out of scope.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use this package when an agent should ground "is this tool available?" in a real answer before planning around it: dependency checks before proposing a build, environment audits, or any flow that would otherwise guess a platform command.

### When to choose it

Choose it when a composition may probe installed dependencies read-only and, when a caller has authorized it, change them one package at a time: `env_inspect` resolves names on `PATH`, `env_version` adds an approval-gated version probe, and `apps_inspect` enumerates installed applications beyond `PATH` on Windows. `pkg_install` and `pkg_uninstall` are the only tools here that change the machine, and a composition that must never mutate it should either omit them or run under a policy that answers every approval with `never`.

### Minimal configuration

Every bound is required with no default: a composition that omits any of them fails at load, and values outside their ranges are rejected at load too. `maxCommands` and `versionMaxCommands` each bound one call's distinct command names — for `env_version` that is also the bound on approval decisions and child processes per call — and `versionTimeoutMs` is the deadline of one `--version` child. `appsDefaultLimit` is the entry count `apps_inspect` returns when the model omits `limit`, `appsMaxLimit` is the largest `limit` one call may use, `appsCacheTtlMs` is the inventory snapshot cache lifetime (`0` disables caching), and `appsTimeoutMs` is the deadline of one inventory collection run. The package-manager bounds are `pkgDefaultLimit`, `pkgMaxPackages`, and `pkgTimeoutMs` for the read probes, and `pkgInstallTimeoutMs` for the deadline of one `pkg_install` or `pkg_uninstall` run.

```yaml
- name: '@deepseek-ai/dsh-experimental-tool-env-inspect'
  config:
    maxCommands: 8
    versionMaxCommands: 4
    versionTimeoutMs: 15000
    appsDefaultLimit: 20
    appsMaxLimit: 100
    appsCacheTtlMs: 60000
    appsTimeoutMs: 30000
    appsMaxSnapshots: 5
    pkgDefaultLimit: 20
    pkgMaxPackages: 100
    pkgTimeoutMs: 30000
    pkgInstallTimeoutMs: 60000
```

| Field | Default | Meaning |
|---|---|---|
| `maxCommands` | required | Distinct command names one `env_inspect` call may probe; accepted range 1-64 |
| `versionMaxCommands` | required | Distinct command names one `env_version` call may probe; accepted range 1-32 |
| `versionTimeoutMs` | required | Deadline of one `env_version` child process in milliseconds; accepted range 1000-120000 |
| `appsDefaultLimit` | required | Installed-application entries one `apps_inspect` call returns when `limit` is omitted; accepted range 1-`appsMaxLimit` |
| `appsMaxLimit` | required | Largest `limit` one `apps_inspect` call may use; accepted range 1-200 |
| `appsCacheTtlMs` | required | Installed-application snapshot cache lifetime in milliseconds; `0` disables caching; accepted range 0-3600000 |
| `appsTimeoutMs` | required | Deadline of one installed-application collection run in milliseconds; accepted range 1000-120000 |
| `appsMaxSnapshots` | required | Named `apps_snapshot` captures one composition keeps before evicting the oldest; accepted range 1-50 |
| `pkgDefaultLimit` | required | Packages one `pkg_inspect` call returns when `limit` is omitted; accepted range 1-`pkgMaxPackages` |
| `pkgMaxPackages` | required | Largest `limit` one `pkg_inspect` call may use; accepted range 1-500 |
| `pkgTimeoutMs` | required | Deadline of one package-manager probe in milliseconds; accepted range 1000-120000 |
| `pkgInstallTimeoutMs` | required | Deadline of one `pkg_install` or `pkg_uninstall` run in milliseconds; accepted range 1000-600000 |

### What each call does

Both tools take bare command names — never paths or arguments — and reject blank and path-shaped names. `env_inspect` resolves each distinct name against the caller's `PATH` in order: on Windows through the `PATHEXT` suffixes, on POSIX through the executable bit. The result carries one entry per command with every matching path in `PATH` order, and the rendered text names the first match or `not found`.

`env_version` resolves each name through the subprocess seam, asks the approval seam for a one-shot decision (`allowed-once` runs the probe; any other outcome — including a `never` session policy or a missing answerer — reports `denied by approval decision`), and runs `<executable> --version` with a `versionTimeoutMs` deadline, a tree-scoped abort, and 4096-byte stdout/stderr capture. A nonzero exit reports the exit code and captured stderr; expiry reports the timeout. The package injects `approval` and `subprocess`, so a composition that omits either service fails at injection.

`apps_inspect` asks the approval seam for one decision per call and then runs a fixed read-only PowerShell script through the optional `ctx.shell` service. The script reads the machine and per-user uninstall keys, machine App Paths keys, and the current user's AppX packages, and emits one JSON object; the tool parses it, classifies each entry (`kind`, `installer`, `arch`, `confidence`), sanitizes every string field, and returns a bounded page. `UninstallString` and `QuietUninstallString` never leave the package — only `hasUninstaller` is reported. Every result names its sources with a status, carries `coverage.notCovered` for anything it could not read, and reports `total`, `returned`, and `truncated`. On a non-Windows host, or when no shell executor is mounted, the result is explicitly unavailable rather than an empty list. `pkg_inspect` runs fixed probes — `winget list --disable-interactivity --accept-source-agreements`, `npm ls -g --depth=0 --json`, and `pip list --format=json` — each behind its own approval decision naming the exact run. The model selects which managers to probe and a limit; no command or argument is ever derived from model input, so a denied manager spawns nothing and is reported as `denied`. Output is bounded, and a manager that is not installed, was denied, or produced unusable output is reported with its status and reason under `coverage.notCovered` rather than as an absence of packages. `chocolatey` and `scoop` are deliberately not probed: their output formats have no verified parser here, and an unverified parser would report guesses as inventory.

`pkg_propose` answers the confirmation question before anything is downloaded: it runs one fixed description probe — `winget show --id <name> --exact`, `npm view <name> --json`, `pip index versions <name>` — behind its own approval decision, and returns the version, publisher, license, artifact location, and the hash the source publishes. The package name is the only model input, it must start alphanumeric and hold only letters, digits, dot, underscore, plus, or hyphen, and it travels as one argv element, so it can neither add a flag nor reach a shell. This tool installs nothing; a caller confirms with it before any change.

`pkg_install` and `pkg_uninstall` are the only tools here that change the machine. Each runs one fixed argv — `winget install --id <name> --exact --silent --accept-package-agreements --accept-source-agreements`, `npm install -g <name>`, or `pip install <name>` to install; `winget uninstall --id <name> --exact --silent`, `npm uninstall -g <name>`, or `pip uninstall -y <name>` to uninstall — with the same package-name validation and the same single-argv-element guarantee. These tools declare `approval: 'explicit'`, so the tool registry asks for the decision before the call body runs; a denial returns a tool error stating that the user rejected the tool, the body never asks a second time, and no process is spawned. A call without an owning agent session fails too, because the decision would have nowhere to be recorded. A manager executable that does not resolve, a nonzero exit, a spawn failure, or `pkgInstallTimeoutMs` expiry is reported as a status with the manager's own stderr tail, and manager output is sanitized before it is quoted. Success is reported as the manager's report, never as a verified change: the flow the tools' own descriptions prescribe is `apps_snapshot` before the call and `apps_diff` after it, and that diff is the only evidence that the machine changed. Artifact download, provenance verification of the fetched artifact, and rollback remain unimplemented.

`apps_snapshot` asks for one approval decision, reads the same sources, and stores the complete unfiltered entry set under a name — a capture whose sources could not all be read is refused rather than stored as an empty baseline, and the store keeps at most `appsMaxSnapshots` captures (a same-named capture replaces its predecessor, and the oldest is evicted past the bound). Because the shell service is resolved per call, a composition without it still loads. `apps_diff` compares a stored snapshot with the machine now (one approval decision) or with another stored snapshot (no machine read), matching entries by stable id and reporting `added`, `removed`, and per-field `changed` rows. Because identity is the source key, a renamed application reads as one changed entry rather than an add plus a remove. Both results state when the two observations did not cover the same sources, so an entry that appears added or removed because a source was not read is never presented as a machine change. Snapshots live in the plugin's memory for the life of the composition and are not durable across a host restart.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tool and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Read-only by default, mutating in one place.** Inspecting what is installed is the safe first step of the installer/environment-manager flow, and every tool except `pkg_install` and `pkg_uninstall` only reads. Those two run one fixed manager argv behind the tool registry's explicit approval gate; artifact download, provenance verification, and rollback stay out of scope until their own slices exist.
- **In-process resolution, no subprocess.** Matching runs through `stat`/`access` against the caller's `PATH`, so the tool adds no execution surface and needs no approval gating beyond the tool call itself.
- **Pure query, no session state.** The tool appends no session event and owns no projection, so no invariant companion is published: there is no durable state whose independent observations could diverge.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, PATH resolution, `env_inspect`/`env_version` registration |
| [`src/types.ts`](src/types.ts) | The one home of the result types and manager ids |
| [`src/apps.ts`](src/apps.ts) | Fixed read-only inventory script, parsing, classification, and the cached reader |
| [`src/apps-tool.ts`](src/apps-tool.ts) | `apps_inspect`, `apps_snapshot`, and `apps_diff` registration and rendering |
| [`src/pkg.ts`](src/pkg.ts) | Fixed read probes and parsers for winget, global npm, and pip |
| [`src/pkg-tool.ts`](src/pkg-tool.ts) | `pkg_inspect` registration and rendering |
| [`src/pkg-propose.ts`](src/pkg-propose.ts) | `pkg_propose` registration and rendering |
| [`src/pkg-mutation.ts`](src/pkg-mutation.ts) | `pkg_install` and `pkg_uninstall`: fixed mutating argv, explicit approval, report-not-verification rendering |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [env inspect Agent Note](../../../.agents/notes/implemented/feature/2026-09-07-env-inspect.md) — why the first slice is read-only resolution and what stays out.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`env_inspect` schema](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-tool-env-inspect) and the [`env_version` schema](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-tool-env-inspect): a required `commands` array of bare command names, answered by a `probes` array of `{ command, paths }` entries (inspect) or `{ command, path?, version?, error? }` entries (version) in request order. The descriptions state the read-only guarantee, the per-probe approval gate, and that shell built-ins and aliases are not visible. The [`apps_inspect` schema](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-tool-env-inspect) exposes optional `query`, `source`, `scope`, `kind`, and `limit` filters and answers with a snapshot, per-source reports, a bounded `apps` array, and a coverage block; its description states that entries are untrusted metadata, that uninstall commands are never returned, and that an unread source is not an absence. The [`pkg_install` and `pkg_uninstall` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-tool-env-inspect) take a required `manager` enum and a required `package` name and answer with the action, manager, package, a status, an exit code, and the manager's stderr tail; their descriptions state the fixed-command rule, the explicit approval decision every call needs, and that a reported success must be confirmed with `apps_diff`.

#### Token effect

Fixed schema cost on every request where the tool is visible; the description and schema are stable for a given configuration.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

Each call retains the requested command names in its arguments. Success renders one line per command — `git: C:\Program Files\Git\cmd\git.exe` or `foo: not found`. Stable failures are `Error: env_inspect accepts at most <n> distinct commands per call (got <n>)`, `Error: invalid probe: command names must be non-empty`, and `Error: invalid probe: `<name>` must be a bare command name, not a path`.

#### Token effect

Token growth scales with the rendered summary — one line per command — not with the full path lists, which stay in the structured result only.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the tool is a poor fit. They are current package constraints, not a task backlog.

- **PATH executables only** — shell built-ins, aliases, and functions are invisible; a command that exists only as a shell feature reads as `not found`.
- **Version probing runs programs** — `env_version` executes each approved resolved executable with `--version`; every run is gated by a one-shot approval decision and fails closed under a `never` policy or without an answerer, but it is still execution.
- **The inventory is Windows-only and not a census** — `apps_inspect` reads registry uninstall entries, App Paths, and AppX packages for the current user; portable applications, Start Menu shortcuts, other users' AppX registrations, and package-manager inventories are out of scope and are named under `coverage.excludes`. On any other platform, or without a mounted shell executor, the result is unavailable rather than empty.
- **Inventory metadata is third-party text** — registry and AppX fields are written by installers, and per-user entries are writable by any process running as this user; values are sanitized, capped, and marked with scope and confidence, and instruction-like text lowers an entry's confidence instead of being interpreted.
- **Snapshots are session-owned, bounded, and non-durable** — `apps_snapshot` keeps at most `appsMaxSnapshots` named captures for the session that made them; another session in the same composition cannot read them, a host restart loses them, and `apps_diff` fails loud for an unknown name rather than comparing against nothing.
- **Package-manager probes are fixed and partial** — `pkg_inspect` runs only the fixed argv of `winget`, global `npm`, and `pip`; a manager that is absent, denied, or unreadable is reported as such, and `chocolatey` and `scoop` are not probed until their output formats have host evidence.
- **Nothing here downloads or rolls back** — `pkg_propose` reports what a manager says about a candidate and names the hash the source publishes; DSH never downloads or verifies that artifact itself, and no tool rolls an installation back. `pkg_install` and `pkg_uninstall` delegate both the fetch and the removal to the selected manager's configured sources.
- **An install or uninstall result is a report, not a verified change** — a manager that exits `0` may still have installed a different version than proposed, upgraded a shared dependency, or left a partially removed package. The tools never claim otherwise, and `apps_diff` against a before-call `apps_snapshot` is the only evidence this package offers.
- **Mutating calls are irreversible from this package's side** — `pkg_install` and `pkg_uninstall` are marked `reversible: true` only in the sense that `pkg_uninstall` (or re-installing) is the inverse operation the manager supports; neither tool keeps a change log, and the package's snapshot store is not a rollback mechanism.
- **Experimental and unmounted by default** — the package is excluded from official releases and no shipped profile mounts it; a deployment must add it explicitly, and that is also where a mutating tool either gets mounted or stays out.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

#### Future: from installation to verification

Inspection, inventory, proposal, and installation have their own slices. What is still missing is the evidence half of the installer plan: artifact download under a package-owned fetch, provenance verification of the fetched artifact against the hash `pkg_propose` reports, and rollback to a captured version. A deployment that wants only the safe subset mounts the package and leaves `pkg_install`/`pkg_uninstall` out, or answers their approvals with `never`.

</details>
