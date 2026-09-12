# Agent Note: A denial budget stops automatic goal continuation

Status: implemented

[English](2026-09-12-goal-approval-denial-stop.md) | 中文

## Problem

演进计划的 §4.3 把 `maxApprovalDenials`（默认 2）与 `maxAttempts`、`maxConsecutiveFailures` 并列，并给出它存在的规则：被拒绝的请求不得以另一种形式重新发出。[同会话驱动器](2026-07-19-same-session-goal-round-driver.zh.md)已经会停止工具调用持续失败的 goal，但 goal 也可能因*被拒绝*而失败：模型每轮都提出一个受限动作，用户拒绝它，而驱动器照旧继续，把剩余的 Round 上限耗在人类已经拒绝的请求上。此前没有任何东西观察审批决定，所以 goal 无法因用户已经给出的理由而停止。

拒绝的输入不是工具结果，而是 `dsh-user-approval` 声明的持久 `approval/decided` 事件。[失败连击停止](2026-09-10-goal-consecutive-failure-stop.zh.md)读取的是 `tool/result` 结果块上的 `isError`，不需要跨包依赖；因此在 `dsh-goal-round-driver` 内统计拒绝数会新增一个依赖。

## Decision

`dsh-goal-round-driver` 统计用户拒绝的审批，并在达到 `maxApprovalDenials` 时停止自动续行。

计数器只在 `approval/decided` 会话事件携带结果 `rejected`、且驱动器为该会话预留的轮次处于 `admitted` 阶段时加一。其他结果与状态被有意排除：`cancelled` 是被撤回的提问，`unavailable` 是 fail-closed 的回答者而非人的决定，而人类轮次中的决定属于人类自己驱动的工作。该闸门与失败连击、Round 上限并列在续行决策处，因此 goal 会在预留下一个 Round 之前被阻塞，稳定代码为 `approval-denials`，消息中点明计数。`approval/asked` + `approval/decided` 审计对留在会话日志中，正是 blocker 所指的被拒决定；驱动器不引用任何决定文本。停止绝不重新询问：驱动器既不重试被拒的调用，也不以另一种形式重述它。

`maxApprovalDenials` 是带声明默认值 2 的受校验插件配置字段，形态与 `maxConsecutiveFailures` 相同：一个带默认值的可选 schemastery 字段，外加针对直接 `apply` 调用的 fail-loud 复检。它属于驱动器的理由与失败上限一致——由驱动器决定是否继续，而模型无法触及的部署值比模型可以放宽的每 goal 数值更安全。

该计数与驱动器其余状态一样是进程内调度状态，并像失败连击一样在相同的观察点上重置：用户授权的 `resume`、新 goal（`create`）以及新的会话开始。它有意不像连击那样在成功的工具结果上重置，因为一次被允许的动作并不能让那些被拒的动作变得可接受。

## Alternatives considered

**把两种停止合并进失败连击的记录。** 否决：两者回答不同的问题、输入不同（工具结果块 vs 审批 seam 的持久结果）、重置规则也不同。一份记录会把一套理由强加给两个决定。两份记录改为互相交叉引用，失败记录当时不愿承担的依赖在这里承担。

**统计除 `allowed-once` 之外的所有 `approval/decided` 结果。** 否决：这会让 fail-closed 的 `unavailable` 回答者——一个配置事实而非人的拒绝——和被撤回的请求也停止 goal，而 blocker 会声称一个从未发生的用户拒绝。只有 `rejected` 才是决定。

**统计会话中任意轮次的拒绝。** 否决：停滞场景是 goal 轮次反复提出被拒的工作。人类轮次中的拒绝是那个人自己的排查，不应悄悄停用他们仍在运行的已启用 goal。

**在 `session/event` 监听器里计数并追加持久停止事件。** 否决理由与失败连击记录相同：在会话监听器内部追加会话事件在本仓库没有先例，而该状态转移已有归属者——驱动器在其续行闸门处提交 goal 状态。

**把上限放到 goal 定义上，像 `maxGoalRounds` 那样。** 否决：goal 自身的字段是持久重放状态，新增一个必须同时加进 fold 的精确键解码器、投影 schema、快照类型以及跨越 Typert Remote 的 `GoalView` DTO；这还会让模型在创建时放宽自己的停止上限。

**再次询问后重试被拒的调用。** 否决：§4.3 规定被拒绝的请求不得以另一种形式重新发出，且本包已声明它没有异常自动重试。停止就是答案。

## Consequences

goal 现在会因第二个由人给出的理由而停止，且 blocker 会点明它：代码携带计数，日志保存询问/结果对，因此读者能看清哪些请求被拒绝。由于停止会停用 goal 的续行，模型无法在同一回合重启它，随后的 resume 会从干净计数开始，而不是立刻被当初使它停止的拒绝再次阻塞。

代价是一个跨包类型依赖：`dsh-goal-round-driver` 为 `ApprovalOutcome` 词汇和 `approval/decided` 会话事件声明 `@deepseek-ai/dsh-user-approval` 为 peer 与 dev 依赖。该导入是纯类型的，且驱动器读取的是任何已挂载审批 seam 本就会追加的事件，因此驱动器在不含 `dsh-user-approval` 的组合中仍能运行，只是观察不到任何拒绝。单元测试用真实审批服务在其确定性的 `never` 策略下覆盖阈值、配置为 1 的阈值、resume 重置、必须不计入的 `unavailable` 结果，以及非法的直接配置。
