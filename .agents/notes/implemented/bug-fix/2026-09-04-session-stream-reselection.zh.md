# Agent Note: Retry a failed live session stream on reselection

Status: implemented

[English](2026-09-04-session-stream-reselection.md) | 中文

## Problem
选中的会话可能在实时事件流失败后仍保留其作用域。再次选择同一会话时，当前会话 ID 没有变化，因此阶段跟随器不会运行，会话也不会重新接收后续助手事件。

## Decision
`ClientSessions.open()` 先执行管理器的常规选择，再显式跟随当前会话。强制跟随仍使用 `Session.open()` 的幂等语义：已打开或正在打开的流保持不变，冷态或失败流创建新的事件窗口。普通列表驱动的跟随仍按阶段变化工作，不会因重复通知而重新打开健康流。

## Alternatives considered
**每次选择前重置阶段。** 这会给健康会话增加关闭和重新打开的开销，也可能在列表短暂遮罩时丢弃冻结作用域。

**在 `SessionEventStream` 内部自行重试，而不增加选择信号。** 这会改变所有消费者的传输失败策略，也无法处理用户在实时流过期后重新选择会话的动作。

## Consequences
重新选择同一会话现在可以修复失败的实时流，同时不影响健康流、延迟作用域清理、持久化选择或模型选择。行为由 `reopens a failed live stream when the current session is selected again` 回归测试覆盖；定向 session-controller 测试和完整 workspace 构建均通过。由于源 checkout 尚未部署到 3080，针对已安装运行时的浏览器验证仍待执行。
