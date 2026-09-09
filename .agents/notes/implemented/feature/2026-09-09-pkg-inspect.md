# Agent Note: Package-manager probes are fixed commands behind per-probe approvals

Status: implemented

English | [中文](2026-09-09-pkg-inspect.zh.md)

## Problem

Registry uninstall entries miss packages that a package manager tracks only in its own state (a global npm tree, a pip environment, winget's manifest store), and the installer plan's slice 3b asked for that inventory. Reading it means executing a package manager, which is the plan's execution surface: it needs a per-probe approval decision, an argument-injection defense, and output that a hostile registry cannot turn into instructions.

## Decision

`pkg_inspect` runs a fixed, package-owned probe per manager: `winget list --disable-interactivity --accept-source-agreements`, `npm ls -g --depth=0 --json`, and `pip list --format=json`. The model selects which managers to probe and a result limit; no command text or argument is ever derived from model input, and the parameter schema's enum plus a validation pass reject any other manager name. Each probe resolves its executable through the subprocess seam, asks `ctx.approval.request` for a one-shot decision whose reason names the exact resolved command line, and only an `allowed-once` outcome spawns anything — a denial is reported as `denied` with no process, an unresolved executable as `unavailable` with no approval asked.

Output is bounded per stream and by `pkgTimeoutMs`; the parser runs on the captured text and its package names and versions pass through the shared field sanitizer, so control characters, bidirectional overrides, and zero-width characters are stripped and long values capped. Package identity is a digest of the manager and the manager's own key, so a display-name change cannot create a second package. Every manager reports its own status (`ok`, `partial`, `unavailable`, `denied`, `failed`) with a reason, and a manager that was not read appears under `coverage.notCovered` rather than as an absence of packages.

`chocolatey` and `scoop` are deliberately not probed. Their output formats have no host evidence here, and an unverified parser would report guesses as inventory; adding them requires capturing their real output first.

## Alternatives considered

**Let the model pass a command or arguments.** Rejected: that turns a read tool into arbitrary execution and makes the approval reason meaningless. A fixed argv keeps the execution surface package-owned.

**Parse the winget table by fixed character offsets.** Rejected: the table pads by display width, so rows with double-width characters shift every later column. Splitting rows on their column padding (two or more spaces) keeps those rows aligned, and a table with no recognizable header is reported as partial instead of guessed.

**Run the managers through the shell tool.** Rejected: a shell string is free-form prose, while this slice needs one approval per fixed command with the exact executable in the reason.

## Consequences

A model can answer "which packages does this manager know about?" without supplying a command line, and a denied manager is provably inert. The slice's adversarial gate pins the denial path (no spawn), the fixed argv actually spawned, the rejection of injection-shaped manager names, and the sanitization of package text; the real composition test reads a real manager through the local subprocess provider. The remaining installer work — the propose-confirm-install-verify-rollback flow — now has both its inventory and its verification primitive.
