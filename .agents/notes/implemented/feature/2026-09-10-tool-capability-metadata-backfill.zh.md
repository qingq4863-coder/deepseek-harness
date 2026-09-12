# Agent Note：已发布文件系统工具声明各自的能力元数据

Status: implemented

[English](2026-09-10-tool-capability-metadata-backfill.md) | 中文

## Problem

`dsh-permission-presets` 的预设能力上限会拒绝任何缺少 `capability.risk` 的工具：上限无法为工具没有声明的东西排序，因此它失败即关闭。上限落地时，仓库里唯一的声明是实验性环境工具，于是每个已发布工具——包括 `read` 与 `write`——在任何声明了 `capabilityRisk` 的预设下都会被拒绝，而没有声明的工具也没有可供审计的风险面。

## Decision

已发布的文件系统工具声明完整元数据：`read`、`read_image`、`glob`、`grep` 为 `dataClass: 'workspace'`、`risk: 'low'`、`reversible: true`、`approval: 'automatic'`；`write`、`edit`、`str_replace_editor` 为 `dataClass: 'workspace'`、`risk: 'medium'`、`reversible: false`、`approval: 'scoped'`。

分类遵循两条规则。风险来自工具**能对机器做什么**，而不是模型预期怎么用它：只读取被许可文件的工具保持 `low`；会改变文件的工具是 `medium` 且不可逆——即使工具在结果里报告了改动前后的内容，harness 也不保留文件写入的撤销手段。同时带读取与写入命令的工具采用写入侧的分类，因此 `str_replace_editor`（`view`、`create`、`str_replace`、`insert`）同时带有读取作用域、写入作用域，以及其最强命令的中等风险。

作用域描述的是**已经治理该工具的边界**——「本次会话中文件系统策略许可的文件」——而不是重述一份由 fs 策略拥有、且可能逐次调用变化的路径清单。`approval` 对读取保持 `automatic`、对变更保持 `scoped`，即这些工具当前的真实行为：沙箱与权限策略拥有变更门禁，只有 `explicit` 与 `prohibited` 会在注册表层新增决定，因此本次变更不会让任何调用多出一次提示。

每个已声明字段都是描述性的：注册表校验取值，上限读取 `risk`；而 `dataClass`、各作用域、`network` 与 `reversible` 服务于审计以及尚不存在的消费者。声明一个取值永远不会授予授权。

命令执行工具以同样方式声明，并落在非 `prohibited` 档的最高处。`bash`（`dsh-tool-bash`）与 `pwsh`（`dsh-tool-pwsh`）为 `dataClass: 'sensitive'`、`risk: 'high'`、`reversible: false`、`approval: 'scoped'`，其读、写、网络作用域点明调用方会话的沙箱模式——也就是真正约束一条命令的边界——而不是沙箱策略自己拥有、且随每次调用变化 的路径与目标清单。命令执行器可以读取、改动并触达其会话沙箱模式所放行的一切，包括它从未有意针对的凭据，因此 `sensitive` 与 `high` 是诚实的取值；`prohibited` 不是，因为该工具是会被正常运行的合法工具，而规划把那一档留给绝不应运行的动作。`approval` 保持 `scoped`，因为沙箱策略与工具自身的逐次升级审批才是门禁：声明 `explicit` 会给每一条命令都加上一个注册级提问。

面向会话与提供方的工具以同样方式声明，并沿用写入工具已经确立的可逆性规则：harness 不提供撤销，因此改变持久状态的工具为 `reversible: false`，无论记录是否保留旧值；只读工具为 `reversible: true`，因为它没有可撤销的东西。`get_goal` 只读且可逆；`create_goal` 与 `update_goal` 会变更且不可逆；`todo_write` 替换会话的任务清单且不可逆；`job_output` 与 `job_list` 只读且可逆；`job_kill` 终止本会话拥有的进程且不可逆。后者也是这一组里唯一的 `medium`：其余都是 `low`，因为它们都无法触达机器——goal、任务清单与作业注册表都是会话拥有的状态，而正是仓库自己的作业注册表把 `job_kill` 限制在本会话启动的进程上。`web_fetch` 与 `web_search` 为 `dataClass: 'public'`，其 `network` 点明约束它们的边界——已挂载抓取提供方所放行的目标、以及已挂载搜索提供方的端点——并采用 `automatic` 审批，这正是规划的风险表对读取公开网页内容已经规定的。`job_output` 为 `sensitive`，因为后台作业的输出就是该作业产生的内容，对 shell 作业而言即命令输出；`job_list` 只携带 id、kind、status 与模型撰写的标签。

委派与编排类工具声明为 `low`，因为它们的触达并不属于自己。`subagent`、`workflow` 与 `ralph` 造成的子级工作运行在**父级的预设**上——`subagent-in-process-driver` 证明了这一继承——因此子级的工具面对同一道天花板，委派工具既无法超越调用方的上限，也不需要高于它的档位；它们的作用域点明子级执行的内容，且不可逆，因为一次运行无法被取消运行。`send_message`、`list_subagent_models`、`list_agents` 与 `skill` 同样以 `low` 读取或引导，其中 `skill` 可逆，因为它只加载技能提供方所放行的技能。`interrupt_agent` 是该族唯一的 `medium`，与 `job_kill` 一致：两者都不可逆地取消进行中的工作，因此天花板低于 `medium` 的预设无法取消自己的工作——这是把 shipped 天花板声明为 `high` 的一个理由。`exit_plan_mode`（`dsh-plan-mode`）同样是 `low`，因为它请人审阅计划并退出计划模式，只动会话状态、不动机器状态。最后这一条也是静态查全性检查的教训：该检查的第一版只看名字以 `dsh-tool` 开头的行，于是漏掉了 `dsh-base` 从 `dsh-plan-mode` 挂载的那一个工具。

## Alternatives considered

**把所有工具都声明为 `risk: 'high'`，这样绝不会误放行。** 否决：拒绝一切的上限等同于没有上限，而规划的目的是让部署级上限通过诚实的排序变得可用。

**因为 `str_replace_editor` 常用命令是 `view`，把它归类为 `low`。** 否决：元数据属于工具而非单次调用，一个放行工具却放行其写入命令的上限是虚假保证。

**给写入工具加 `approval: 'explicit'` 以匹配风险。** 否决：显式声明会让工具注册表对每次调用都提示，重复沙箱与权限策略在越界写入时已经获得的审批，并把常规的工作区内编辑变成提示。`scoped` 说的才是事实：既有策略拥有该决定。

**对没有消费者的字段留空。** 否决：元数据是一份契约，校验器只能因遗漏而非因形状拒绝不完整的取值，审计某个工具触达面的评审者不该还要去推断声明的哪一半是真的。

## Consequences

声明 `capabilityRisk: 'medium'` 的预设现在会放行这四个检查工具，并以既有的失败即关闭消息拒绝未声明工具；`low` 上限会拒绝 `write` 并点明其声明的风险。`packages/fs/tool-fs/tests/capability-ceiling.spec.ts` 针对真实注册表、真实预设服务与真实文件系统栈钉住这三种结果，只把 shell 与审批服务作为桩挂载；一旦移除某个声明它就会失败，这正是它成为回归测试而非复述的原因。

其余已发布工具定义仍未声明任何元数据，在带上限的预设下仍会失败即关闭。各族的分类方式相同：读取为 `low` 加 `automatic`；工作区或机器变更为 `medium` 或更高，并用与其策略本来就采用的门禁相匹配的审批取值；`explicit` 保留给「自身确认即是门禁」的动作——安装器工具就是现成例子。委派族与 `exit_plan_mode` 声明完成后，`web` 或 `headless` 组合挂载的每一个工具都带有元数据——`dsh-base` 的行加上 `dsh-web-app` 那一个 settings 贡献——这正是 §4.2 所走 B 方案的前置条件；`dsh-tools` 不是反例，因为它的两处 `defineTool` 调用是工厂自带的夹具而非产品工具。尚未完成的是常驻命令对（`dsh-tool-bash-persistent`、`dsh-tool-pwsh-persistent`）——只有 `dsh-sdk-minimal` 挂载它们，且需要先给出单一共享声明来源——以及没有任何 shipped 组合可达的工具包：`dsh-tool-terminal`、`dsh-tool-lsp`、`dsh-tool-cordis`、`dsh-tool-session-query`、`dsh-schedule`、`dsh-experimental-tool-agent-team` 与 `dsh-tool-ask-user`。

常驻命令变体（`dsh-tool-bash-persistent`、`dsh-tool-pwsh-persistent`）保持未声明。这两个包是近乎镜像的文件，在两者中都声明该族元数据会把一段共享 token 推过 `pnpm run duplication` 的阈值：同一份声明在两个非常驻工具上不产生任何克隆，而在这一对上新增 13 处跨文件克隆——该数字通过逐侧撤回实测得出。声明它们应属于一次先为该对给出单一共享声明来源的改动，使该族的风险陈述只有一个归属处。

`packages/shell/tool-pwsh/tests/capability-ceiling.spec.ts` 针对真实注册表、真实沙箱策略服务与真实预设服务钉住命令工具的上限行为：`high` 上限放行 `pwsh`，未声明天花板的预设照旧执行它，`medium` 上限以 `risk "high"` 拒绝它，未声明工具仍然失败即关闭。
