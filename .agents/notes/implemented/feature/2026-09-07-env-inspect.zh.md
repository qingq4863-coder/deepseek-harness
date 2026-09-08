# Agent Note：只读环境检查先行

Status: implemented

[English](2026-09-07-env-inspect.md) | 中文

## 问题

总体规划的安装器与环境管理器流程以检查机器状态起步，其第一条成功标准是「检查应用或依赖是否已安装」。Harness 此前没有对应的语义化面：模型只能通过 shell 猜平台命令（`where`、`which`、`Get-Command`），猜错浪费一轮且无法落到结构化状态上。

## 决策

`@deepseek-ai/dsh-experimental-tool-env-inspect` 交付 `env_inspect` 工具：输入裸命令名，每个名字输出一条 `{ command, paths }` 探测结果，按 `PATH` 顺序排列。解析在进程内对文件系统完成——只用 `stat`/`access`，绝不执行——因此工具除工具调用本身外不增加审批面，且 Windows `PATHEXT` 与 POSIX 可执行位语义都成立。每次调用的命令上限是必填的 `maxCommands` 配置（1-64，配置错误在加载时失败），沿用 todo 工具的必填选择模式。本包不发布 `./invariant` 伴生插件，因为它不拥有任何持久状态：纯查询没有会因独立观察而分歧的持久不变量。

本包有意放在 `packages/experimental/` 下：被排除在正式发布之外，没有任何 shipped profile 挂载它，已记录会话的快照面保持不变。部署在 cordis.yml 里加入条目即可选择启用。

## 考虑过的替代方案

**通过 shell 解析（`where`/`which`）。** 否决：语义随平台与 shell 变化，结果是散文而非结构化路径，而且 shell 调用是执行面——只读查询不需要它。

**第一切片就包含版本探测。** 先延期、后单独交付：`--version` 会运行找到的程序——这是需要审批门禁的执行面，门禁设计见[版本探测](2026-09-07-env-version.zh.md)；只读切片落地时不带它。

**现在就挂载进 shipped profiles。** 延期：没有背后的安装流程时该工具依然有用，但后续安装切片的审批策略应当决定整个家族如何暴露，而不只是查询这一环。

## 后果

挂载该工具的组合获得有依据的是/否答案与确切可执行路径，模型不再猜平台命令。版本探测此后作为受门禁的执行面加入本包（[版本探测](2026-09-07-env-version.zh.md)）；安装器规划剩余的切片——`PATH` 之外的已装程序清单与 propose-confirm-install-verify 流程——各自增加执行或变更面，应作为独立切片并带各自的审批门禁落地。experimental 位置是暂时的：一旦存在稳定归属者与真实组合消费方，就按与其他包相同的规则晋级。
