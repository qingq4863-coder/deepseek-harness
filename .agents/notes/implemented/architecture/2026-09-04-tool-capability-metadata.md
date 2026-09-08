# Agent Note: Keep tool capability metadata descriptive

Status: implemented

English | [中文](2026-09-04-tool-capability-metadata.zh.md)

## Problem

Planning and policy consumers need to know a tool's declared risk, data class, scope, reversibility, and approval expectation. The existing `ToolRuntime` already owns registration, scope resolution, model-schema projection, execution, and disposal; a second capability registry would duplicate those responsibilities.

## Decision

`ToolDefinition` accepts optional `capability` metadata. `ToolRuntime.register()` validates its closed classifications and scope arrays, while `defineTool()` preserves the metadata. `schemas()` continues to project only model-facing fields, and the metadata never grants permission by itself. The permission-preset capability ceiling reads it as descriptive input and denies through a monotonic tool guard ([preset capability ceiling](../feature/2026-09-04-preset-capability-ceiling.md)); `tools/pre-execute` listeners, sandbox policy, and approval outcomes otherwise ignore it.

At execution, `approval: prohibited` is denied before extensible policy listeners; `approval: explicit` upgrades an allow result to an existing approval request; `automatic` and `scoped` remain descriptive.

## Alternatives considered

**Create a second Cordis capability registry.** Rejected because no independent consumer or provider contract currently requires a second registry; it would duplicate `ctx.tools` lifecycle and scope behavior.

**Make metadata mandatory.** Rejected because raw ToolDefinition objects, MCP interop, fixtures, and existing providers must remain structurally compatible.

**Add metadata to `ToolSchema`.** Rejected because schema projection would risk exposing policy and implementation details to the model.

## Consequences

Policy consumers can inspect descriptive metadata through the resolved tool definition, including scoped shadowing, without changing model-visible schemas or authorization. Metadata is untrusted provider input and cannot replace enforcement in the executor or policy pipeline. The focused tool suite covers preservation, model exclusion, and malformed metadata rejection; the source typecheck passes.
