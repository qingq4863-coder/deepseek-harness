# Agent Note：Todo 条目携带完成证据

Status: implemented

[English](2026-09-05-todo-evidence.md) | 中文

## 问题

总体规划的任务编排模型要求每个完成步骤都有证据。todo 列表——agent 的持久任务面——此前只记录 `content` 加三态 `status`，`completed` 条目无法区分「我认为做完了」与「这已验证过」，恢复的会话也无从知道哪些步骤有证明。这以唯一可选字段扩展了原始的最小条目形状（[todo write 工具](2026-06-29-todo-write-tool.zh.md)）。

## 决策

`TodoItem` 增加可选的 `evidence` 一行：通过的检查或证明已完成任务的产物。工具描述邀请模型在 `completed` 条目上附加；执行时做 trim、拒绝空行、拒绝非完成条目上的 evidence。持久不变量校验其形状（存在即必须是非空已 trim 字符串），并刻意对哪些状态可以携带保持沉默——与并行 in-progress 策略相同的回放兼容规则，一种策略下写入的日志在另一种策略下仍可回放。`todos` 投影 schema 接受该字段并把 `stateVersion` 升到 3。

强制执行是必填的部署选择，而非编码规则：`requireCompletedEvidence`（无默认值，配置错误在加载时失败）沿用 `allowParallelInProgress` 的模式。`true` 把邀请变成门禁——描述要求证明行，没有证据的完成项会被拒绝；`false` 保留邀请。Shipped profiles 选择 `false`，因此所有 shipped 组合的模型可见描述保持不变；需要该纪律的部署翻开开关即可。

## 考虑过的替代方案

**在 shipped profiles 中默认开启强制执行。** 否决：对每个完成 todo——包括琐碎的清单项——都要求证据，会改变全部 shipped 组合的模型可见约定，并迫使模型编造证明行；该纪律属于需要它的部署。

**第四种 `verified` 状态。** 否决：三态是文档化的可移植生命周期；第四种状态要让所有模型、UI 与 SDK 消费者学一个新词，而证据行已经表达了这件事。

**证据作为独立会话事件。** 否决：整表替换就是写入模型——必须在替换后存活的证据属于条目本身。

## 后果

完成的 todo 现在可以把证明带过日志、投影与 SDK 面，恢复的会话能看到哪些步骤已验证。部署用 `requireCompletedEvidence: true` 选择启用强制执行；任一取值都能回放在另一策略下写入的历史。已记录会话的快照 sidecar（工具 schema 与 system prompt）已为新模型可见 schema 与描述刷新；Windows 上 refresh 治具以损坏编码与平台分歧工具集写盘，因此 sidecar 改用 UTF-8 批量变换更新，仍有待 Linux 快照通道重新验证。
