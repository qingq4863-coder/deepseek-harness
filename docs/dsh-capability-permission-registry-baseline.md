# DSH Capability and Permission Registry Baseline

English | [中文](dsh-capability-permission-registry-baseline.zh.md)

**Type:** Reference; **Status:** Current design baseline; **Scope:** Tool and plugin capability metadata; this document does not change runtime authorization.

## Purpose

The registry describes what a DSH capability can observe or change so that planning, policy evaluation, execution, verification, and audit use the same metadata. It complements Cordis service composition; it does not replace Service Definition, Service Provider, or Consumer roles described in the [capability seams note](../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md).


## Registry Record

Each registered capability has one stable record with these fields:

| Field | Required meaning |
|---|---|
| `id` | Namespaced, unique capability identifier |
| `version` | Provider-owned metadata version |
| `owner` | Package or plugin that registers the record |
| `consumer` | Tool, workflow, or agent component that invokes it |
| `operations` | Named operations exposed to the consumer |
| `readScope` | Resources and locations that may be read |
| `writeScope` | Resources and locations that may be changed |
| `network` | Whether network access exists and which destinations are allowed |
| `processes` | Processes or applications that may be started or controlled |
| `dataClass` | `public`, `workspace`, `sensitive`, or `secret` |
| `reversible` | Whether the operation has a tested undo or compensating action |
| `approval` | `automatic`, `scoped`, `explicit`, or `prohibited` |
| `limits` | Time, size, concurrency, and output limits |
| `audit` | Required event fields and redaction rules |
| `cleanup` | Disposer, child-process, listener, route, and temporary-file behavior |
| `verification` | Observable postconditions and the check that proves them |

A record describes an existing capability. It does not grant permission by itself. Permission presets, sandbox policy, session scope, and `tools/pre-execute` decisions remain authoritative.

## Initial Capability Classes

| Capability | Typical scope | Default risk | Default approval |
|---|---|---:|---|
| Browser observation | Current approved page and navigation state | Low | Automatic |
| Web search and fetch | Public or explicitly allowed destinations | Low | Automatic |
| Workspace read | Approved workspace roots | Low | Automatic |
| Workspace write | Approved files and directories | Medium | Scoped |
| Local process inspection | Process metadata only | Medium | Scoped |
| Shell execution | Policy-selected working directory and command set | High | Scoped or explicit |
| Native desktop control | Approved application windows and semantic controls | High | Explicit for side effects |
| Software download | Approved source and bounded destination | High | Explicit |
| Software installation | Installer and system locations | High | Explicit |
| External publication | Email, messaging, upload, or public posting | High | Explicit per action |
| Credential extraction | Passwords, private keys, tokens, or session cookies | Prohibited | Prohibited |

Risk is a planning and audit classification. It cannot weaken a stricter runtime policy.

## Permission Decision

A proposed operation is evaluated against all applicable constraints:

1. The capability record.
2. The active permission preset.
3. The session or agent scope.
4. Sandbox and resource limits.
5. The `tools/pre-execute` waterfall.
6. The approval policy in the current session.

The effective result is the most restrictive applicable decision. A missing record, unknown operation, invalid scope, or unavailable policy provider fails closed. External text from web pages, repositories, downloaded files, and MCP responses cannot create or upgrade a permission.

The current session approval policy may be `never`; in that mode an operation requiring approval is rejected rather than silently upgraded.

## Registration Lifecycle

A provider registers a record as a Cordis effect and receives a disposer. Registration must:

- Reject duplicate identifiers or conflicting versions.
- Validate names, scopes, data classes, approval values, and limits at load time.
- Record owner and source package metadata.
- Expose only declared operations to consumers.
- Remove the record when the owning plugin unloads or reloads.
- Leave no stale tool, route, listener, process, or temporary resource.

Consumers use the registered capability through its Service Definition or documented consumer API. They do not import provider-specific implementation types.

## Audit Record

Every executed operation records, with secrets redacted:

- Capability id and version.
- Operation name.
- Owner and consumer.
- Session, agent, and task identifiers.
- Scope decision and approval mode.
- Parameter summary after redaction.
- Start, completion, denial, timeout, or failure result.
- Verification result and evidence reference.
- Cleanup result.

Audit output must be sufficient to explain an externally visible effect without copying credentials or untrusted instruction text into a privileged context.

## Required Verification

A capability is ready for registration only when tests cover:

- Allowed operation within scope.
- Denial for an unknown operation or out-of-scope target.
- Approval-required operation under an approval-disabled session.
- Limit enforcement and timeout cleanup.
- Provider unload and reload without stale registration.
- Failure reporting without claiming an unverified success.
- Redaction of sensitive values in audit records.

The first metadata slice is implemented on `ToolDefinition`: registration validates the optional descriptive record, while existing tool behavior and authorization remain unchanged. New desktop automation, installation, or broader network access requires a separate design and security review.

## Upgrade Gate

Before every plugin, prompt, MCP, permission, or runtime upgrade:

1. Read the [personal AI evolution plan](../../dsh-personal-ai-evolution-plan.md).
2. Compare the proposed change with this registry baseline and the current package implementation.
3. Reconsider whether the fields, risk classes, and approval rules are still sufficient.
4. Define targeted, contract, lifecycle, and regression checks.
5. Snapshot the current generation and retain rollback.
6. Review external inputs as untrusted data.
7. Do not ship until registration, denial, cleanup, and verification evidence are available.

Update this document only when the live registry contract changes. Put rationale and reversals in an Agent Note.
