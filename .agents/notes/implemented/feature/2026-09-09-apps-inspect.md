# Agent Note: Installed-application inventory stays read-only and honest about coverage

Status: implemented

English | [中文](2026-09-09-apps-inspect.zh.md)

## Problem

`env_inspect` answers only what is on `PATH`, so a model asked about an application installed outside it — an MSI, a per-user install, a Store package — had no grounded answer. The installer plan's next slice needed an inventory, and the obvious shortcuts are all wrong: `Win32_Product` triggers an MSI consistency check and can repair packages, `reg.exe` output is text to parse, and returning `UninstallString` hands the model a command line to execute. The registry values themselves are third-party text, and the per-user hive is writable by any process running as that user.

## Decision

`apps_inspect` joins `@deepseek-ai/dsh-experimental-tool-env-inspect` as a read-only Consumer over a fixed package-owned collection script. The script reads the machine and per-user uninstall keys, the machine App Paths keys, and the current user's AppX packages through registry-provider cmdlets (no `.NET` static calls, so it also runs under a ConstrainedLanguage PowerShell), targets the 32-bit `WOW6432Node` subtree explicitly rather than relying on a registry view, and emits one JSON object with per-source status. It runs through the optional `ctx.shell` service resolved at call time, so a composition without a shell executor still loads and reports every source as not read; the model chooses only filters and a limit, never the command.

Every call asks `ctx.approval.request` for one decision before reading anything, matching the machine-inventory row of the plan's risk table; a non-allow outcome returns an unavailable result. Returned entries carry a stable id derived from the source id and the source's own key, plus `scope`, `kind`, `installer`, `arch`, and `confidence`. Registry and AppX strings are sanitized (control, bidirectional-override, and zero-width characters removed, whitespace collapsed, 200-character cap with `truncatedFields`), instruction-like text lowers an entry's confidence instead of being interpreted, and `UninstallString`/`QuietUninstallString` never leave the package — only `hasUninstaller` is reported. `kind: 'app'` is the default filter, so `SystemComponent`, `ReleaseType`, and `ParentKeyName` artifacts do not crowd out real applications, and a registry row without a display name is skipped.

Results are bounded and honest: `limit` is capped by required config, the render is one line per entry, and the result reports `total`, `returned`, `truncated`, per-source status, and `coverage.notCovered`. A source that could not be read is never rendered as an absence, and a non-Windows host reports the whole inventory as unavailable rather than empty. The last successful collection is cached for `appsCacheTtlMs` (`0` disables caching); a failure never serves stale data.

## Alternatives considered

**In-process native registry reads (`advapi32` via koffi).** Deferred: it removes the shell process entirely, but the repository has no Windows native host yet, and the plan's desktop-automation item would justify that investment once. The fixed script through the already-governed shell seam ships now.

**`Win32_Product` or `reg.exe`.** Rejected: `Win32_Product` has side effects (MSI consistency checks and possible repair), and `reg.exe` output is unstructured text that would need fragile parsing. Registry-provider cmdlets are read-only and return typed values.

**Returning uninstall commands.** Rejected: an uninstall string is a change surface, and handing it to the model invites execution. `hasUninstaller` answers the useful question without it; a later uninstall slice can expose the command behind its own approval.

**Cross-source merging by display name.** Rejected: display names are mutable and collide across products. Entries keep their own source identity; the plan's merge rule applies once a stable cross-source identity exists.

## Consequences

A model can answer "is this application installed, and which version?" without executing anything, and can tell an unread source from a confirmed absence. The slice's adversarial gate runs through its own data path: sanitization and confidence-lowering are pinned for instruction-like, control-character, and oversized metadata, the fixed script is asserted to be the only command the tool ever runs, and a denial performs no read. The real composition test enumerates the host machine through the governed pwsh channel. The next slices — package-manager inventories with their own execution surfaces, then snapshot/diff and the install flow — each widen the approval question and land separately.
