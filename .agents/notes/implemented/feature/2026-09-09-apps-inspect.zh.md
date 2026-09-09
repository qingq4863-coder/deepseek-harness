# Agent Note：已安装应用清单保持只读，并对覆盖面保持诚实

Status: implemented

[English](2026-09-09-apps-inspect.md) | 中文

## 问题

`env_inspect` 只回答 `PATH` 上有什么，所以模型被问到装在 `PATH` 之外的应用程序——MSI、用户级安装、应用商店包——时没有可依据的答案。安装器规划的下一片需要一份清单，而几条显而易见的捷径都是错的：`Win32_Product` 会触发 MSI 一致性检查并可能修复包，`reg.exe` 的输出是需要解析的文本，而返回 `UninstallString` 等于把一条命令行交给模型去执行。注册表里的值本身是第三方文本，用户级 hive 又可被任何以该用户身份运行的进程写入。

## 决策

`apps_inspect` 加入 `@deepseek-ai/dsh-experimental-tool-env-inspect`，作为包内固定采集脚本之上的只读 Consumer。脚本通过注册表提供程序 cmdlet 读取机器级与用户级卸载键、机器级 App Paths 键以及当前用户的 AppX 包（不使用 `.NET` 静态调用，因此也能在 ConstrainedLanguage 的 PowerShell 下运行），显式定位 32 位的 `WOW6432Node` 子树而不依赖注册表视图，并输出一个带逐来源状态的 JSON 对象。它经调用时解析的可选 `ctx.shell` 服务运行，因此没有 shell 执行器的组合仍能加载，并把每个来源都报告为未读取；模型只能选择过滤条件与上限，永远不能选择命令。

每次调用在读取任何内容之前先向 `ctx.approval.request` 请求一次决定，与规划风险表中的整机清单行一致；非允许的结果返回不可用。返回的条目带有由来源 id 与来源自身键派生的稳定 id，以及 `scope`、`kind`、`installer`、`arch` 与 `confidence`。注册表与 AppX 字符串会被清洗（剔除控制字符、双向覆盖符与零宽字符，折叠空白，200 字符上限并记录 `truncatedFields`），类指令文本会降低条目置信度而不会被解释，`UninstallString`/`QuietUninstallString` 永不离开本包——只报告 `hasUninstaller`。默认过滤是 `kind: 'app'`，因此 `SystemComponent`、`ReleaseType` 与 `ParentKeyName` 产物不会挤占真正的应用程序，没有显示名的注册表行会被跳过。

结果受界且诚实：`limit` 由必填 config 封顶，渲染每条目一行，结果报告 `total`、`returned`、`truncated`、逐来源状态与 `coverage.notCovered`。读不到的来源永远不会被渲染成不存在，非 Windows 主机会把整份清单报告为不可用而不是空。最近一次成功采集会按 `appsCacheTtlMs` 缓存（`0` 关闭缓存）；失败永不返回陈旧数据。

## 考虑过的替代方案

**进程内原生读取注册表（经 koffi 调用 `advapi32`）。** 延后：它能完全去掉 shell 进程，但仓库目前还没有 Windows 原生宿主，而规划中的桌面自动化项才值得一次性投资。经已被治理的 shell seam 执行固定脚本可以先落地。

**`Win32_Product` 或 `reg.exe`。** 否决：`Win32_Product` 有副作用（MSI 一致性检查并可能修复），而 `reg.exe` 输出是非结构化文本，需要脆弱解析。注册表提供程序 cmdlet 是只读的，并返回有类型的值。

**返回卸载命令。** 否决：卸载字符串是变更面，把它交给模型等于诱导执行。`hasUninstaller` 已经回答了有用的问题；后续的卸载切片可以在自己的审批之后暴露该命令。

**按显示名做跨源合并。** 否决：显示名可变且会在不同产品间重名。条目保留各自的来源身份；规划的合并规则在有稳定的跨源身份之后再适用。

## 后果

模型无需执行任何东西就能回答「这个应用程序是否已安装、版本是多少」，并能区分「来源未读取」与「确认不存在」。本切片的对抗门禁走的是它自己的数据路径：类指令文本、控制字符与超长元数据的清洗与置信度下调都有用例钉住，固定脚本被断言为该工具唯一会运行的命令，被拒绝时不发生任何读取。真实组合测试通过受治理的 pwsh 通道枚举宿主机。后续切片——带各自执行面的包管理器清单、随后的快照/差异与安装流程——每一步都会扩大审批问题，应各自独立落地。
