# Agent Note：工具能力元数据保持描述性

Status: implemented

[English](2026-09-04-tool-capability-metadata.md) | 中文

## 问题

规划与策略消费者需要读取工具声明的风险、数据类别、范围、可逆性和审批预期。现有 `ToolRuntime` 已拥有注册、作用域解析、模型 schema 投影、执行和清理；再建一个能力注册表会重复这些职责。

## 决策

`ToolDefinition` 接受可选的 `capability` 元数据。`ToolRuntime.register()` 校验其封闭分类与范围数组，`defineTool()` 保留这些元数据。`schemas()` 继续只投影模型可见字段，元数据本身永不授予权限。权限预设的能力上限将它作为描述性输入读取，并通过单调的工具 guard 拒绝（[预设能力上限](../feature/2026-09-04-preset-capability-ceiling.zh.md)）；`tools/pre-execute` 监听器、沙箱策略与审批结果在其他方面不受它影响。

执行时，`approval: prohibited` 在可扩展策略监听器之前被拒绝；`approval: explicit` 将允许结果升级为现有审批请求；`automatic` 与 `scoped` 仍只是描述性信息。

## 考虑过的替代方案

**创建第二个 Cordis 能力注册表。** 否决：当前没有独立消费者或 provider 契约需要第二个注册表；它会重复 `ctx.tools` 生命周期与作用域行为。

**强制要求元数据。** 否决：原始 ToolDefinition 对象、MCP 互操作、fixtures 与现有 providers 必须保持结构兼容。

**把元数据加入 `ToolSchema`。** 否决：schema 投影会有把策略与实现细节暴露给模型的风险。

## 后果

策略消费者能通过已解析的工具定义读取描述性元数据，包括作用域 shadowing，且不改变模型可见 schema 或授权。元数据是不可信 provider 输入，不能取代执行器或策略管线的强制执行。聚焦工具套件覆盖保留、模型排除和畸形元数据拒绝；源码 typecheck 已通过。
