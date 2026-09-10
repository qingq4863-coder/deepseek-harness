# Agent Note：连续失败连击会停止 goal 的自动续行

Status: implemented

[English](2026-09-10-goal-consecutive-failure-stop.md) | 中文

## Problem

演进规划 §4.3 要求为每个 goal 提供停止阈值：`maxConsecutiveFailures`（默认 3），与 `maxAttempts`、`maxApprovalDenials` 并列。[同会话驱动器](2026-07-19-same-session-goal-round-driver.zh.md)会把已启用续行的 goal 一直推进到 Round 上限，但没有任何东西观察到「轮次本身一直在失败」：工具调用每轮都以同样方式失败的 goal，会在停止之前耗尽整个上限，而每一轮都要花掉一次完整的模型轮次。该阈值必须在预留下一轮**之前**就停止 goal，并且绝不能变成重试策略——规划与本包都拒绝自动重试。

## Decision

`dsh-goal-round-driver` 统计连续的失败工具结果，并在达到上限时停止自动续行。失败标记是 `tool/result` 事件结果块上的 `isError` 字段，而不是 payload 中可选的 `error`——后者携带的是内部失败身份，而不是面向模型的失败。

计数存放在驱动器进程内的调度状态中，紧邻其预留记录；它只在三种观察下变化：失败的工具结果使其加一，成功的工具结果将其清零，用户授权的 `resume` 同样将其清零。新的会话开始也会清零。该门禁与 Round 上限在同一处求值——即续行决策处、预留 Round 之前——并以稳定代码 `consecutive-failures` 阻塞 goal，消息中点明连击长度。失败的调用留在会话日志里，那正是 blocker 所指的失败清单；驱动器不自行引用任何错误文本。

`maxConsecutiveFailures` 是带声明默认值 3 的受校验插件配置字段，形态与 `dsh-tool-goal` 自家阈值一致：可选 schemastery 字段加默认值，外加对直接 `apply` 调用的失败即报复核。该上限属于驱动器而非 goal 定义，因为它约束的是续行决策；也因为模型无法触及的部署值，比模型可以在创建时放宽的逐 goal 数值更安全。

## Alternatives considered

**像 `maxGoalRounds` 那样把阈值加进 goal 定义。** 否决：goal 自身的字段是持久重放状态，新增一个字段必须同时落到 fold 的精确键解码器、投影 schema、快照类型，以及跨越 Typert Remote 的 `GoalView` DTO 上。对 goal 从不读取的值而言，这是一次影响重放格式的大改动，而且会让模型在创建时放宽自己的停止上限。

**在 `session/event` 监听器里追加一条持久停止事件来完成计数。** 按规划中记录的侦察结果否决：在会话监听器内部追加会话事件在本仓库没有先例，而该状态迁移已经有归属者——驱动器在其续行门禁处提交 goal 状态，正是它处理 `round-limit` 的方式。

**在每轮开始时清零连击。** 否决：值得捕获的情形是 goal 每轮各失败一次、连续烧掉数轮；逐轮清零只能看到单轮内部的失败。

**只统计发生在已接纳 goal Round 内部的失败。** 作为不必要的复杂化否决：连击只可能在续行门禁处生效，而带着已启用续行的 goal 走到门禁的途径只有「自动续行继续」或「用户 resume」（后者会清零计数）。因此更简单的全局会话计数不会因为用户未授权的、与 goal 无关轮次的失败而停止 goal。

**重试失败的调用而不是停止。** 否决：规划中的停止阈值正是为了约束自主工作，而本包已写明没有异常自动重试。驱动器选择停止并停用自动续行；用户 resume 是唯一的继续途径。

**复用 `dsh-tool-goal` 的 `blockedAfterConsecutiveRounds`。** 否决：那个阈值是面向模型的策略——它在轮次足够之前拒绝模型自己提出的 `blocked` 主张——而且它数的是轮次而非失败。两者回答的是不同问题，各自留在自己的包内。

## Consequences

goal 现在会带着人类判断所需的理由停止：代码说明连击，日志持有调用记录。由于停止会停用自动续行，模型无法在同一轮内重启它，而随后的 resume 从干净计数开始，不会因当初使它停止的连击再次被阻塞。

与驱动器其余调度状态一样，该计数器是进程内的；宿主重启后会从后续工具结果重新推导，而不是重放它。停止的持久记录是 goal 的 blocker，它可以精确重放。单元测试用真实 agent loop、一个总是失败与一个总是成功的 fixture 工具覆盖该阈值：连击停止、被成功结果打断的连击、配置为 2 的阈值、resume 清零、非法的直接配置，以及解析默认值的直接 `apply`。同一规划段落中的 `maxApprovalDenials` 仍未实现：它的输入是 `approval/decided`，由 `dsh-user-approval` 声明，因此在驱动器内统计它会引入 `tool/result` 标记并不需要的跨包类型依赖。
