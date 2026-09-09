---
description: "Experimental read-only env_inspect tool that resolves command names against PATH, for users and maintainers checking whether a dependency is installed."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-env-inspect

English | [中文](README.zh.md)

## Summary

`dsh-experimental-tool-env-inspect` gives the model three environment tools. `env_inspect` is read-only: it takes a list of command names and answers, for each one, which executable files exist on `PATH` — the first hit is the one a shell would run — or that the command is not installed; resolution runs in-process against the filesystem, so nothing is executed. `env_version` is the package's one execution surface: it resolves each name, asks the approval seam for a one-shot allow/reject decision, and runs the approved executable's `--version` in a time-limited child process with bounded output capture. `apps_inspect` enumerates installed applications from read-only Windows inventory sources — machine and per-user registry uninstall entries, App Paths launch names, and the current user's AppX/MSIX packages — through the optional shell seam; it never runs a discovered program and never returns uninstall commands. All three are experimental: excluded from official releases, they carry no stability promise and are mounted only by compositions that explicitly include them. This package is the environment-manager plan's read-and-probe slices; download, install, and verification stay out of scope.

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

Choose it when a composition may probe installed dependencies read-only: `env_inspect` resolves names on `PATH`, `env_version` adds an approval-gated version probe, and `apps_inspect` enumerates installed applications beyond `PATH` on Windows. Avoid it for package-manager inventories or anything that changes the machine.

### Minimal configuration

Every bound is required with no default: a composition that omits any of them fails at load, and values outside their ranges are rejected at load too. `maxCommands` and `versionMaxCommands` each bound one call's distinct command names — for `env_version` that is also the bound on approval decisions and child processes per call — and `versionTimeoutMs` is the deadline of one `--version` child. `appsDefaultLimit` is the entry count `apps_inspect` returns when the model omits `limit`, `appsMaxLimit` is the largest `limit` one call may use, `appsCacheTtlMs` is the inventory snapshot cache lifetime (`0` disables caching), and `appsTimeoutMs` is the deadline of one inventory collection run.

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

### What each call does

Both tools take bare command names — never paths or arguments — and reject blank and path-shaped names. `env_inspect` resolves each distinct name against the caller's `PATH` in order: on Windows through the `PATHEXT` suffixes, on POSIX through the executable bit. The result carries one entry per command with every matching path in `PATH` order, and the rendered text names the first match or `not found`.

`env_version` resolves each name through the subprocess seam, asks the approval seam for a one-shot decision (`allowed-once` runs the probe; any other outcome — including a `never` session policy or a missing answerer — reports `denied by approval decision`), and runs `<executable> --version` with a `versionTimeoutMs` deadline, a tree-scoped abort, and 4096-byte stdout/stderr capture. A nonzero exit reports the exit code and captured stderr; expiry reports the timeout. The package injects `approval` and `subprocess`, so a composition that omits either service fails at injection.

`apps_inspect` asks the approval seam for one decision per call and then runs a fixed read-only PowerShell script through the optional `ctx.shell` service. The script reads the machine and per-user uninstall keys, machine App Paths keys, and the current user's AppX packages, and emits one JSON object; the tool parses it, classifies each entry (`kind`, `installer`, `arch`, `confidence`), sanitizes every string field, and returns a bounded page. `UninstallString` and `QuietUninstallString` never leave the package — only `hasUninstaller` is reported. Every result names its sources with a status, carries `coverage.notCovered` for anything it could not read, and reports `total`, `returned`, and `truncated`. On a non-Windows host, or when no shell executor is mounted, the result is explicitly unavailable rather than an empty list. Because the shell service is resolved per call, a composition without it still loads.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tool and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Read-only slice of a larger plan.** Inspecting what is installed is the safe first step of the installer/environment manager flow; download, verification, and installation stay out of scope until their own slices exist.
- **In-process resolution, no subprocess.** Matching runs through `stat`/`access` against the caller's `PATH`, so the tool adds no execution surface and needs no approval gating beyond the tool call itself.
- **Pure query, no session state.** The tool appends no session event and owns no projection, so the package publishes no `./invariant` companion: there is no durable state whose independent observations could diverge.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, PATH resolution, `env_inspect` registration |
| [`src/types.ts`](src/types.ts) | The one home of the `EnvCommandProbe` result type |

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

The model sees the generated [`env_inspect` schema](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-tool-env-inspect) and the [`env_version` schema](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-tool-env-inspect): a required `commands` array of bare command names, answered by a `probes` array of `{ command, paths }` entries (inspect) or `{ command, path?, version?, error? }` entries (version) in request order. The descriptions state the read-only guarantee, the per-probe approval gate, and that shell built-ins and aliases are not visible. The [`apps_inspect` schema](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-tool-env-inspect) exposes optional `query`, `source`, `scope`, `kind`, and `limit` filters and answers with a snapshot, per-source reports, a bounded `apps` array, and a coverage block; its description states that entries are untrusted metadata, that uninstall commands are never returned, and that an unread source is not an absence.

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
- **No installer flow** — download, provenance verification, installation, and rollback are out of scope; this package never changes the machine beyond running approved `--version` probes.
- **Experimental and unmounted by default** — the package is excluded from official releases and no shipped profile mounts it; a deployment must add it explicitly.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

#### Future: from inspection to installation

The natural next slices are the package-manager inventories (`winget`, `chocolatey`, `scoop`, `npm`, `pip`, each with its own approval-gated execution surface), snapshot and diff as the install-verification primitive, and the propose-confirm-install-verify flow of the installer plan. Each adds an approval surface and should land as its own slice.

</details>
