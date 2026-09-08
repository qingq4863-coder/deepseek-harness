# Agent Note：版本探测把执行门禁在一次性审批之后

Status: implemented

[English](2026-09-07-env-version.md) | 中文

## 问题

只读的 `env_inspect` 切片回答了「装没装」，但没有回答「能不能用」：模型仍然无法把版本要求（`git >= 2.30`、某个 Python minor）落到真实答案上。运行 `<cmd> --version` 属于执行——正是第一切片有意留在门外的那一面——所以需要单独决定「谁说了算」。

## 决策

`env_version` 加入 `@deepseek-ai/dsh-experimental-tool-env-inspect`，成为本包唯一的执行面。对每个命令，它经子进程 seam 解析可执行文件，向 `ctx.approval.request` 请求一次性决定（reason 指名确切的 `"<path>" --version` 运行），只有 `allowed-once` 结果才会运行子进程：受界的 `--version` spawn，带 `versionTimeoutMs` 死线、树级中止和固定 4096 字节 stdout/stderr 捕获。每个非允许结果——`never` 会话策略、缺失或抛错的应答者、取消——都变成一条 `denied by approval decision` 探测条目，因此工具与审批子系统一样确定性关闭。本包现在声明式注入 `approval` 与 `subprocess`：省略任一服务的组合在注入时失败，而不是拿到一个被悄悄削弱的工具。

三个上限（`maxCommands`、`versionMaxCommands`、`versionTimeoutMs`）保持必填无默认——todo 工具的显式选择模式——配置错误在加载时失败。本包不发布 `./invariant` 伴生：审批审计由 `dsh-user-approval` 的 invariant 拥有，探测结果自身不新增持久状态。

## 考虑过的替代方案

**在 `env_inspect` 上加 `versions: true` 标志。** 否决：翻转标志就把只读工具变成执行器，这一点会被参数掩盖；而且审批 seam 要求真实 Agent turn——只读工具刻意不需要的形态。独立工具让信任边界在模型的工具列表里可见。

**通过 shell 解析（把 `cmd --version` 组进 bash 调用）。** 否决：bash 工具存在，但它的命令串是自由散文，不是在决定 reason 里指名确切可执行文件的逐探测审批；模型还得猜它本来能从 `env_inspect` 拿到的平台解析。

**把输出上限做成 config 字段。** 延期：4096 字节是版本横幅的固定结果契约，不是随部署变化的选择；只有当真实程序的横幅被证明截断时再重访。

## 后果

挂载本包的部署获得有依据的版本答案与确切可执行路径，每次运行都可归因到日志里的 `approval/asked` + `approval/decided` 事件对。真实组合测试经本机 subprocess provider 运行宿主自己的 `node --version`，并证明无应答者时的 fail-closed 路径；`never` 策略由审批子系统自己的套件覆盖。安装器规划的后续切片——`PATH` 之外的已装程序清单、然后下载/验证/安装——都会扩大审批问题的范围，应分别落地。
