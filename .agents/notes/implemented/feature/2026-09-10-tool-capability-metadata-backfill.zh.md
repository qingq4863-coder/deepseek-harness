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

## Alternatives considered

**把所有工具都声明为 `risk: 'high'`，这样绝不会误放行。** 否决：拒绝一切的上限等同于没有上限，而规划的目的是让部署级上限通过诚实的排序变得可用。

**因为 `str_replace_editor` 常用命令是 `view`，把它归类为 `low`。** 否决：元数据属于工具而非单次调用，一个放行工具却放行其写入命令的上限是虚假保证。

**给写入工具加 `approval: 'explicit'` 以匹配风险。** 否决：显式声明会让工具注册表对每次调用都提示，重复沙箱与权限策略在越界写入时已经获得的审批，并把常规的工作区内编辑变成提示。`scoped` 说的才是事实：既有策略拥有该决定。

**对没有消费者的字段留空。** 否决：元数据是一份契约，校验器只能因遗漏而非因形状拒绝不完整的取值，审计某个工具触达面的评审者不该还要去推断声明的哪一半是真的。

## Consequences

声明 `capabilityRisk: 'medium'` 的预设现在会放行这四个检查工具，并以既有的失败即关闭消息拒绝未声明工具；`low` 上限会拒绝 `write` 并点明其声明的风险。`packages/fs/tool-fs/tests/capability-ceiling.spec.ts` 针对真实注册表、真实预设服务与真实文件系统栈钉住这三种结果，只把 shell 与审批服务作为桩挂载；一旦移除某个声明它就会失败，这正是它成为回归测试而非复述的原因。

其余已发布工具定义仍未声明任何元数据，在带上限的预设下仍会失败即关闭。各族的分类方式相同：读取为 `low` 加 `automatic`；工作区或机器变更为 `medium` 或更高，并用与其策略本来就采用的门禁相匹配的审批取值；`explicit` 保留给「自身确认即是门禁」的动作——安装器工具就是现成例子。
