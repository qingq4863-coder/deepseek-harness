# Agent Note: Install and uninstall run one fixed manager command behind an explicit approval decision

Status: implemented

English | [中文](2026-09-09-pkg-mutation.zh.md)

## Problem

The installer plan's §4.4 flow reaches its second half: proposing a package answered "what would installing this do?" without changing anything, and the remaining question was how the model may actually install or remove one. §7 requires explicit authorization for the two surfaces that half expands — network reach, because a manager fetches or removes artifacts from its configured sources, and machine mutation, because an installer changes the machine. Once authorized, the shape of the tool is fixed by what it must *not* be able to do: accept a command, an argument, or a version from the model; run at all when the decision was a denial; or present a manager's exit code as proof that the machine changed.

## Decision

`pkg_install` and `pkg_uninstall` each run one fixed package-owned argv. Install is `winget install --id <name> --exact --silent --accept-package-agreements --accept-source-agreements`, `npm install -g <name>`, or `pip install <name>`; uninstall is `winget uninstall --id <name> --exact --silent`, `npm uninstall -g <name>`, or `pip uninstall -y <name>`. The model supplies the manager and the package name, nothing else, and the name passes the same validation `pkg_propose` uses — it must start alphanumeric and hold only letters, digits, dot, underscore, plus, or hyphen — so it travels as one argv element that can neither become a flag nor reach a shell.

Each tool declares `capability.approval: 'explicit'`, so the tool registry asks for the decision **before** dispatch: a non-allow outcome denies the call, returns the rejection as the tool error, and never reaches the body. That is the single gate. The body does not repeat the request, so the tools never ask twice and the enforced decision is the one the declared capability promises. The capability declaration states what the call costs: `dataClass: 'sensitive'`, `risk: 'high'`, `reversible: true`, `writeScope` naming the machine's installed packages through the selected manager, and `network` naming the manager's own fetch or removal from its configured sources. A call without an owning agent session fails, because the decision would have nowhere to be recorded.

The outcome is one of `ok`, `unavailable`, `denied`, or `failed`, with the manager's exit code when a process ran and exited, and a sanitized tail of the manager's stderr in the failure notes. `pkgInstallTimeoutMs` bounds a run and aborts its process tree; each stream is capped. A success renders as what the manager reported and names the confirmation the caller owes: an `apps_snapshot` captured before the call, compared with `apps_diff` after it. Neither tool claims a verified machine change, and neither keeps a change log.

## Alternatives considered

**Ask through `ctx.approval.request` inside the body, as `env_version` does.** Rejected: the registry's explicit gate already covers the whole call, so a second request would prompt twice for one decision and would let the body's gate drift from the declared capability. One gate, declared where the registry can see it.

**Verify the change inside the tool by re-probing the manager's inventory.** Rejected: `pkg_inspect` probes one manager's records, while a mutation can add, remove, or upgrade something another manager owns, and a manager's own record of a package is not the machine's application state. Verification stays where the package already put it — `apps_snapshot` before, `apps_diff` after.

**Let the model pass a version or extra flags.** Rejected: model-supplied flags are exactly the change surface worth withholding, and a pinned version is a decision the manager's policy and `pkg_propose` already answer.

**Keep the package propose-only.** Rejected: the user authorized the install and mutation half explicitly, which is the condition §7 sets.

## Consequences

The model can install or remove a package by name only, and a denied call spawns nothing. A reported success is a report: the package's only evidence of a machine change remains the snapshot/diff pair, which is also why the two mutating tools are the package's sole entries with `risk: 'high'`. The tests pin the fixed argv per manager and action, the denial path with no spawn, an unresolvable manager executable reported as `unavailable` with no spawn, a nonzero exit carrying the sanitized stderr tail, the timeout, the invalid-name and unknown-manager failures, and the absence of an exit code when a run was signal-killed. Rollback and provenance verification of a fetched artifact remain unimplemented; `pkg_uninstall` is the manager's inverse operation, not a rollback to a captured version.
