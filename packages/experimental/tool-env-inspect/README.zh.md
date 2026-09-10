---
description: "实验性面向模型的环境工具：PATH 与版本探测、已安装应用清单、包管理器候选查询，以及受审批门禁的安装与卸载。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-env-inspect

[English](README.md) | 中文

## 概述

`dsh-experimental-tool-env-inspect` 给模型九个环境工具。`env_inspect` 是只读的：接收一组命令名，对每个名字回答 `PATH` 上存在哪些可执行文件——第一个命中就是 shell 会执行的那个——或该命令未安装；解析在进程内对文件系统完成，不执行任何东西。`env_version` 是本包逐命令的执行面：解析每个名字、向审批 seam 请求一次性允许/拒绝决定、然后在有死线限制和输出界控制的子进程里运行获批可执行文件的 `--version`。`apps_inspect` 经可选的 shell seam 从只读的 Windows 清单来源枚举已安装应用程序——机器级与用户级注册表卸载项、App Paths 启动名，以及当前用户的 AppX/MSIX 包；它从不运行发现到的程序，也从不返回卸载命令。`apps_snapshot` 捕获该清单的一份受界具名观测，`apps_diff` 按稳定条目 id 比较两份观测，报告一次安装、更新或卸载改变了什么。`pkg_inspect` 在每个被选中的包管理器各自的审批决定之后运行其固定只读命令，并报告该管理器记录的软件包；`pkg_propose` 在安装之前解析管理器对某个候选包的说法。`pkg_install` 与 `pkg_uninstall` 是本包仅有的会改变机器状态的工具面：各自在一条指明确切解析后命令的显式审批决定之后运行一条固定的包管理器 argv，并报告管理器的说法，而不是已验证的变更。九个工具都是实验性的：被排除在正式发布之外，不带稳定性承诺，只被显式包含它们的组合挂载。本包是环境管理器规划的读取、探测、候选、安装与验证切片；产物下载与回滚留在外面。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当 agent 需要在围绕某个工具制定计划之前，用真实答案回答「这个工具可用吗」时使用本包：构建前的依赖检查、环境审计、或任何原本要靠猜平台命令的流程。

### 何时选择

当组合需要以只读方式探测已安装依赖、并在调用方已授权时逐个包改变它们时选择它：`env_inspect` 解析 `PATH` 上的名字，`env_version` 增加受审批门禁的版本探测，`apps_inspect` 在 Windows 上枚举 `PATH` 之外的已安装应用程序。`pkg_install` 与 `pkg_uninstall` 是本包仅有的改变机器状态的工具；绝不能改变机器状态的组合应当不挂载它们，或在每个审批都以 `never` 作答的策略下运行。

### 最小配置

每个上限都是必填项、没有默认值：省略任何一项的组合会在加载时失败，超出范围的值同样在加载时被拒绝。`maxCommands` 与 `versionMaxCommands` 分别约束一次调用的不同命令名数量——对 `env_version` 而言这也是每次调用的审批决定与子进程数量上限——`versionTimeoutMs` 是单个 `--version` 子进程的死线。`appsDefaultLimit` 是模型省略 `limit` 时 `apps_inspect` 返回的条目数，`appsMaxLimit` 是一次调用可用的最大 `limit`，`appsCacheTtlMs` 是清单快照的缓存存活时间（`0` 关闭缓存），`appsTimeoutMs` 是一次清单采集运行的死线。包管理器相关上限中，`pkgDefaultLimit`、`pkgMaxPackages` 与 `pkgTimeoutMs` 约束只读探测，`pkgInstallTimeoutMs` 是一次 `pkg_install` 或 `pkg_uninstall` 运行的死线。

```yaml
- name: '@deepseek-ai/dsh-experimental-tool-env-inspect'
  config:
    maxCommands: 8
    versionMaxCommands: 4
    versionTimeoutMs: 15000
    appsDefaultLimit: 20
    appsMaxLimit: 100
    appsCacheTtlMs: 60000
    appsTimeoutMs: 30000
    appsMaxSnapshots: 5
    pkgDefaultLimit: 20
    pkgMaxPackages: 100
    pkgTimeoutMs: 30000
    pkgInstallTimeoutMs: 60000
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxCommands` | 必填 | 一次 `env_inspect` 调用可探测的不同命令名数量；接受范围 1-64 |
| `versionMaxCommands` | 必填 | 一次 `env_version` 调用可探测的不同命令名数量；接受范围 1-32 |
| `versionTimeoutMs` | 必填 | 单个 `env_version` 子进程死线（毫秒）；接受范围 1000-120000 |
| `appsDefaultLimit` | 必填 | 省略 `limit` 时一次 `apps_inspect` 调用返回的已安装应用条目数；接受范围 1-`appsMaxLimit` |
| `appsMaxLimit` | 必填 | 一次 `apps_inspect` 调用可用的最大 `limit`；接受范围 1-200 |
| `appsCacheTtlMs` | 必填 | 已安装应用快照的缓存存活时间（毫秒）；`0` 关闭缓存；接受范围 0-3600000 |
| `appsTimeoutMs` | 必填 | 一次已安装应用采集运行的死线（毫秒）；接受范围 1000-120000 |
| `appsMaxSnapshots` | 必填 | 一个组合在驱逐最旧项之前保留的具名 `apps_snapshot` 捕获数量；接受范围 1-50 |
| `pkgDefaultLimit` | 必填 | 省略 `limit` 时一次 `pkg_inspect` 调用返回的软件包数量；接受范围 1-`pkgMaxPackages` |
| `pkgMaxPackages` | 必填 | 一次 `pkg_inspect` 调用可用的最大 `limit`；接受范围 1-500 |
| `pkgTimeoutMs` | 必填 | 一次包管理器探测的死线（毫秒）；接受范围 1000-120000 |
| `pkgInstallTimeoutMs` | 必填 | 一次 `pkg_install` 或 `pkg_uninstall` 运行的死线（毫秒）；接受范围 1000-600000 |

### 每次调用做什么

两个工具都接收裸命令名——不是路径、不是参数——并拒绝空白名与路径形名字。`env_inspect` 按调用方 `PATH` 顺序解析每个不同的名字：Windows 走 `PATHEXT` 后缀，POSIX 检查可执行位。结果按请求顺序为每个命令携带一条条目，含 `PATH` 顺序的全部命中路径，渲染文本给出首个命中或 `not found`。

`env_version` 经子进程 seam 解析每个名字，向审批 seam 请求一次性决定（`allowed-once` 才会运行探测；任何其他结果——包括 `never` 会话策略或缺失应答者——报告 `denied by approval decision`），然后以 `versionTimeoutMs` 死线、树级中止和 4096 字节 stdout/stderr 捕获运行 `<executable> --version`。非零退出报告退出码与捕获的 stderr；超时报告超时。本包注入 `approval` 与 `subprocess`，因此省略任一服务的组合会在注入时失败。

`apps_inspect` 每次调用向审批 seam 请求一次决定，然后经可选的 `ctx.shell` 服务运行一个固定的只读 PowerShell 脚本。脚本读取机器级与用户级卸载键、机器级 App Paths 键以及当前用户的 AppX 包，输出一个 JSON 对象；工具解析它、为每个条目分类（`kind`、`installer`、`arch`、`confidence`）、清洗每个字符串字段，并返回受界的一页。`UninstallString` 与 `QuietUninstallString` 永不离开本包——只报告 `hasUninstaller`。每个结果都带来源及其状态，对读不到的内容给出 `coverage.notCovered`，并报告 `total`、`returned` 与 `truncated`。在非 Windows 主机上，或没有挂载 shell 执行器时，结果显式标记为不可用，而不是空列表。`pkg_inspect` 运行固定探测——`winget list --disable-interactivity --accept-source-agreements`、`npm ls -g --depth=0 --json`、`pip list --format=json`——每个探测都在自己的一次审批决定之后运行，理由指明确切命令。模型只选择要探测的管理器与上限；任何命令或参数都不会来自模型输入，因此被拒绝的管理器不产生任何进程并报告为 `denied`。输出受界，未安装、被拒绝或输出不可用的管理器会带着状态与原因列在 `coverage.notCovered` 下，而不是被当成「没有安装任何包」。`chocolatey` 与 `scoop` 有意不探测：它们在本机没有已验证的解析器，未经验证的解析器会把猜测当成清单。

`pkg_propose` 回答下载之前的确认问题：它运行一条固定的描述探测——`winget show --id <name> --exact`、`npm view <name> --json`、`pip index versions <name>`——各自在自己的审批决定之后，返回版本、发布者、许可证、产物位置，以及源公布的哈希。包名是唯一的模型输入，必须以字母数字开头且只含字母、数字、点、下划线、加号或连字符，并作为单个 argv 元素传递，因此既不能添加标志也到不了 shell。本工具不安装任何东西；任何变更之前都由调用方用它确认。

`pkg_install` 与 `pkg_uninstall` 是本包仅有的改变机器状态的工具。各自运行一条固定 argv——安装为 `winget install --id <name> --exact --silent --accept-package-agreements --accept-source-agreements`、`npm install -g <name>` 或 `pip install <name>`；卸载为 `winget uninstall --id <name> --exact --silent`、`npm uninstall -g <name>` 或 `pip uninstall -y <name>`——并采用相同的包名校验与相同的「只传单个 argv 元素」保证。这两个工具声明 `approval: 'explicit'`，因此工具注册表在调用体运行之前就要到决定：被拒绝时返回说明用户拒绝了该工具的工具错误，调用体不会再问第二次，也不会产生任何进程。没有归属 agent 会话的调用同样失败，因为该决定无处记录。管理器可执行文件解析不到、非零退出、启动失败或 `pkgInstallTimeoutMs` 到期都会以状态加管理器自身 stderr 尾部报告，管理器输出在引用前先经清洗。成功只报告为管理器的说法、绝不报告为已验证的变更：工具描述所规定的流程是在调用前 `apps_snapshot`、调用后 `apps_diff`，而那份差异是本包唯一能提供的变更证据。产物下载、对已取回产物的来源验证，以及回滚仍未实现。

`apps_snapshot` 请求一次审批决定、读取相同的来源，并把完整未过滤的条目集以某个名字保存——来源没有全部读到的捕获会被拒绝，而不是存成空基线；存储最多保留 `appsMaxSnapshots` 份捕获（同名捕获替换前一份，超过上限时驱逐最旧的一份）。由于 shell 服务在每次调用时解析，没有它的组合仍能加载。`apps_diff` 把已存快照与当前机器比较（一次审批决定），或与另一份已存快照比较（不读取机器），按稳定 id 匹配条目并报告 `added`、`removed` 与逐字段的 `changed` 行。由于身份就是来源键，被改名的应用程序会显示为一条变更条目，而不是一次新增加一次移除。两个结果都会说明两次观测是否覆盖了相同的来源，因此「因为某个来源没读到而显示为新增或移除」的条目绝不会被当成机器变化。快照存放在插件内存中、随组合存活，不跨宿主重启持久化。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释工具背后的设计决策，并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **更大规划中默认只读、仅一处可变。** 检查已安装什么是安装器／环境管理器流程中安全的第一步，除 `pkg_install` 与 `pkg_uninstall` 外每个工具都只读取；那两个在工具注册表的显式审批门禁之后运行一条固定管理器 argv，产物下载、来源验证与回滚留待各自的切片。
- **进程内解析、无子进程。** 匹配通过 `stat`/`access` 对调用方 `PATH` 完成，工具不增加任何执行面，除工具调用本身外不需要审批门禁。
- **纯查询、无会话状态。** 工具不追加会话事件、不拥有投影，因此本包不发布 `./invariant` 伴生插件：不存在会因独立观察而分歧的持久状态。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、PATH 解析、`env_inspect`/`env_version` 注册 |
| [`src/types.ts`](src/types.ts) | 结果类型与管理器 id 的唯一归属地 |
| [`src/apps.ts`](src/apps.ts) | 固定的只读清单脚本、解析、分类与带缓存的读取器 |
| [`src/apps-tool.ts`](src/apps-tool.ts) | `apps_inspect`、`apps_snapshot`、`apps_diff` 的注册与渲染 |
| [`src/pkg.ts`](src/pkg.ts) | winget、全局 npm 与 pip 的固定只读探测与解析 |
| [`src/pkg-tool.ts`](src/pkg-tool.ts) | `pkg_inspect` 的注册与渲染 |
| [`src/pkg-propose.ts`](src/pkg-propose.ts) | `pkg_propose` 的注册与渲染 |
| [`src/pkg-mutation.ts`](src/pkg-mutation.ts) | `pkg_install` 与 `pkg_uninstall`：固定变更 argv、显式审批、报告而非验证的渲染 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。

- [env inspect Agent Note](../../../.agents/notes/implemented/feature/2026-09-07-env-inspect.zh.md)——为何第一切片是只读解析、哪些内容留在外面。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型会看到生成的 [`env_inspect` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-tool-env-inspect) 与 [`env_version` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-tool-env-inspect)：必填的 `commands` 裸命令名数组，由按请求顺序的 `probes` 数组（inspect 的 `{ command, paths }` 条目、version 的 `{ command, path?, version?, error? }` 条目）回答。描述说明了只读保证、逐探测的审批门禁，以及 shell 内建命令与别名不可见。[`apps_inspect` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-tool-env-inspect) 暴露可选的 `query`、`source`、`scope`、`kind` 与 `limit` 过滤，并回答快照、逐来源报告、受界的 `apps` 数组与覆盖块；其描述说明条目是不可信元数据、卸载命令永不返回，以及读不到的来源并不代表不存在。[`pkg_install` 与 `pkg_uninstall` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-tool-env-inspect) 接收必填的 `manager` 枚举与必填的 `package` 名，回答动作、管理器、包名、状态、退出码与管理器的 stderr 尾部；其描述说明固定命令规则、每次调用所需的显式审批决定，以及报告的成功必须用 `apps_diff` 确认。

#### Token 影响

工具可见的每个请求都有固定 schema 开销；在给定配置下描述与 schema 保持稳定。

#### KV Cache 影响

定义与可见性不变时前缀保持稳定。插件生命周期或作用域限制可能使从此 schema 起的复用失效。

### 工具调用历史与结果

#### 模型看到什么

每次调用都在参数中保留请求的命令名。成功时每个命令渲染一行——`git: C:\Program Files\Git\cmd\git.exe` 或 `foo: not found`。稳定失败文本为 `Error: env_inspect accepts at most <n> distinct commands per call (got <n>)`、`Error: invalid probe: command names must be non-empty`、以及 `Error: invalid probe: `<name>` must be a bare command name, not a path`。

#### Token 影响

token 用量随渲染摘要增长——每命令一行——而不是完整路径列表；后者只留在结构化结果里。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使既有 KV-cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明工具何时不合适。它们是当前包约束，不是任务积压。

- **仅 PATH 可执行文件**——shell 内建、别名与函数不可见；只以 shell 特性存在的命令会读作 `not found`。
- **版本探测会运行程序**——`env_version` 执行每个获批的解析结果并带 `--version` 参数；每次运行都由一次性审批决定门禁，并在 `never` 策略或无应答者时确定性关闭，但它仍是执行。
- **清单仅限 Windows 且不是普查**——`apps_inspect` 读取注册表卸载项、App Paths 与当前用户的 AppX 包；便携应用、开始菜单快捷方式、其他用户的 AppX 注册以及包管理器清单不在范围内，并会在 `coverage.excludes` 中列出。在任何其他平台、或没有挂载 shell 执行器时，结果是不可用而不是空列表。
- **清单元数据是第三方文本**——注册表与 AppX 字段由安装器写入，用户级条目可被任何以该用户身份运行的进程写入；值会经清洗、长度截断，并标注作用域与置信度，类指令文本会降低条目置信度而不会被解释。
- **快照按会话所有、受界且不持久**——`apps_snapshot` 为发起它的会话保留最多 `appsMaxSnapshots` 份具名捕获；同一组合中的另一个会话读不到它们，宿主重启会丢失它们，`apps_diff` 对未知名字会明确失败，而不是拿空基线比较。
- **包管理器探测固定且不完整**——`pkg_inspect` 只运行 `winget`、全局 `npm` 与 `pip` 的固定 argv；缺失、被拒绝或读不到的管理器会如实报告，`chocolatey` 与 `scoop` 在有宿主证据之前不探测。
- **这里不下载、不回滚**——`pkg_propose` 报告管理器对候选包的说法并给出源公布的哈希；DSH 从不自行下载或验证该产物，也没有任何工具回滚一次安装。`pkg_install` 与 `pkg_uninstall` 把取回与移除都委托给所选管理器配置的来源。
- **安装或卸载结果是报告，不是已验证的变更**——退出码为 `0` 的管理器仍可能装了与候选不同的版本、升级了共享依赖，或留下部分移除的包。工具从不声称相反；调用前的 `apps_snapshot` 与调用后的 `apps_diff` 之差是本包唯一提供的证据。
- **变更调用在本包一侧不可逆**——`pkg_install` 与 `pkg_uninstall` 标注 `reversible: true`，仅指管理器支持 `pkg_uninstall`（或重新安装）作为逆操作；两个工具都不保留变更日志，本包的快照存储也不是回滚机制。
- **实验性且默认不挂载**——本包被排除在正式发布之外，没有任何 shipped profile 挂载它；部署必须显式添加——挂载变更工具还是把它们留在外面，也在这一步决定。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：未决问题与尚未决定的方向。它明确不具权威性——已交付行为、限制与既定理由以上文、包代码和相关 Agent Note 为准。

#### 未来：从安装到验证

检查、清单、候选与安装都已有各自的切片。仍然缺少的是安装器规划中的证据那一半：在包自有取回流程下下载产物、用 `pkg_propose` 报告的哈希验证已取回产物的来源、以及回滚到捕获过的版本。只要安全子集的部署可以挂载本包但不挂载 `pkg_install`/`pkg_uninstall`，或让它们的审批一律以 `never` 作答。

</details>
