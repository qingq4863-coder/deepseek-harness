# Agent Note：预设能力上限通过单调 guard 拒绝

Status: implemented

[English](2026-09-04-preset-capability-ceiling.md) | 中文

## 问题

工具能力元数据切片（[工具能力元数据](../architecture/2026-09-04-tool-capability-metadata.zh.md)）让每个预设都会执行所有已声明工具：`PresetSpec` 只捆绑沙箱与审批两个 knob，想要低风险 profile 的部署没有办法按会话约束哪些工具可以运行。

## 决策

`PresetSpec` 增加可选的 `capabilityRisk` 上限。`PermissionPresetService` 经 `ctx.inject(['tools'])` 在 tools runtime 上注册一个单调 guard；当有效预设设置上限时，guard 拒绝声明 `capability.risk` 高于上限的工具和没有 capability 元数据的工具，拒绝理由指明工具、其风险与所属预设。无 agent 的执行没有会话，也就没有上限。

用单调 guard 而非 `tools/pre-execute` 监听器：guard 在可扩展 waterfall 之后运行，allow 决策无法绕过上限，执行器拥有强制执行点。

## 考虑过的替代方案

**为上限新增会话事件。** 否决：预设表已经从 `permissions` 投影派生有效预设，上限搭现有 `permission/preset` 折叠即可，无需新事件类型。

**在 `ToolRuntime` 中读取预设服务来执行。** 否决：core/tools 会依赖 interaction 包；guard 保持 interaction → core 的依赖方向。

**只拒绝高于上限的工具。** 否决：未声明工具会悄悄绕过刻意设置的上限；启用上限即让该预设进入「只允许已声明能力」模式。

## 后果

预设现在是唯一的会话级可配置能力策略：restricted 风格的 profile 无需新事件、注册表或客户端改动即可约束执行风险。上限只比较声明的元数据——元数据低估其行为的工具会通过；包 README 已把这一点记录为已知限制。聚焦测试覆盖默认行为不变、高于上限拒绝、未声明工具拒绝与 waterfall 后执行；`pnpm run typecheck`、`pnpm run verify-type-equiv` 与 `pnpm run test:docs` 通过。
