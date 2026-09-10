# Agent Note: Package proposals stay read-only

Status: implemented

English | [中文](2026-09-09-pkg-propose.zh.md)

## Problem

The installer plan's §4.4 flow asks for the proposed download, version, license, size, and permissions *before* anything is downloaded or installed, and for explicit confirmation before either. The package-manager inventory already answers "what is installed"; nothing yet answered "what would installing this do?", and the answer has to come from a command that a hostile package name must not be able to steer.

## Decision

`pkg_propose` runs one fixed description probe per manager — `winget show --id <name> --exact --disable-interactivity --accept-source-agreements`, `npm view <name> --json`, `pip index versions <name>` — behind its own approval decision. The package name is the only model input: it must start alphanumeric and hold only letters, digits, dot, underscore, plus, or hyphen, and it travels as a single argv element of a fixed command, so it can neither become a flag nor reach a shell. Every probe resolves its executable through the subprocess seam, records its status and reason, and is bounded by the same `pkgTimeoutMs` and output cap as `pkg_inspect`.

The result carries the version the manager would install, the newest version the source lists, the locally recorded version when the manager reports one (absence is not evidence of absence, so `pkg_inspect` remains the tool for that question), the publisher, the license, the artifact location, and the hash the source publishes. The hash is labelled as reported rather than verified, because DSH does not fetch or check the artifact in this slice. Every field passes through the shared sanitizer, and the render states plainly that nothing was downloaded or installed and that installing needs an explicit confirmation step.

The install, verify, and rollback half of §4.4 is a separate decision and not this slice's subject: performing it expands both network reach (fetching an artifact) and machine mutation (running an installer), which §7 of the plan requires explicit approval for. Installing and uninstalling a named package are implemented as fixed manager commands behind the tool registry's explicit approval gate ([mutation note](2026-09-09-pkg-mutation.md)); this note covers only what a proposal may report.

## Alternatives considered

**Implement propose and install together.** Rejected for now: bundling them would hide a network-and-mutation expansion inside a read-only slice. The plan's upgrade protocol requires approval for that expansion, and a rollback rehearsal has to be run against a package the user chooses.

**Return the exact install command line in the proposal.** Rejected: it is the same change surface the inventory slice withholds, and a caller that wants to see the command sees it in the approval prompt when the install tool exists. The proposal keeps the structured fields instead.

**Derive the "already installed" answer from the same probe.** Rejected: only pip reports it, so a proposal that implied a machine-wide answer would be wrong on winget and npm. `pkg_inspect` answers that question across all three.

## Consequences

A caller can present a concrete, sourced proposal and stop, and the model cannot turn a hostile package name into a flag or a command. The adversarial cases pin the name validation (including leading hyphens, paths, shell metacharacters, and over-long names), the denial path with no spawn, the fixed argv actually spawned, the failure/partial/timeout statuses, and the sanitization of every returned field. Verification stays with the snapshot/diff pair: [the mutation note](2026-09-09-pkg-mutation.md) keeps that rule for the install and uninstall tools, and rollback plus provenance verification of the fetched artifact remain unimplemented.
