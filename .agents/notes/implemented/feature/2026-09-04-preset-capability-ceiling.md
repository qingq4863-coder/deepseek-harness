# Agent Note: Preset capability ceiling denies through a monotonic guard

Status: implemented

English | [中文](2026-09-04-preset-capability-ceiling.zh.md)

## Problem

The tool capability metadata slice ([tool capability metadata](../architecture/2026-09-04-tool-capability-metadata.md)) left every preset executing every declared tool: `PresetSpec` bundled only the sandbox and approval knobs, so a deployment wanting a low-risk profile had no per-session way to bound which tools run.

## Decision

`PresetSpec` gains an optional `capabilityRisk` ceiling. `PermissionPresetService` registers one monotonic guard on the tools runtime through `ctx.inject(['tools'])`; while the effective preset sets a ceiling, the guard denies declared tools whose `capability.risk` ranks above it and tools without capability metadata, with the denial reason naming the tool, its risk, and the preset. Agent-less executions carry no session and no ceiling.

A monotonic guard, not a `tools/pre-execute` listener: guards run after the extensible waterfall, so an allow decision cannot bypass the ceiling, and the executor owns the enforcement point.

## Alternatives considered

**A new session event for the ceiling.** Rejected: the preset table already derives the effective preset from the `permissions` projection, so the ceiling rides the existing `permission/preset` fold without a new event type.

**Enforcing in `ToolRuntime` by reading the preset service.** Rejected: core/tools would depend on an interaction package; the guard keeps the dependency direction interaction → core.

**Denying only above-ceiling tools.** Rejected: an undeclared tool would silently bypass a deliberately set ceiling; enabling a ceiling opts the preset into declared-capabilities-only operation.

## Consequences

Presets are now the one session-configurable capability policy: restricted-style profiles cap executed risk without new events, registries, or client changes. The ceiling compares declared metadata only — a tool whose metadata understates its behavior passes; the package README records this as a known limitation. Focused tests cover unchanged default behavior, above-ceiling denial, undeclared-tool denial, and post-waterfall enforcement; `pnpm run typecheck`, `pnpm run verify-type-equiv`, and `pnpm run test:docs` pass.
