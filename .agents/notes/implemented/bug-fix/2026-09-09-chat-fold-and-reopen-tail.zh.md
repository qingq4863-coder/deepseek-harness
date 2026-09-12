# Agent Note: Keep the Chat fold alive and a reopened Session at its live tail

Status: implemented

[English](2026-09-09-chat-fold-and-reopen-tail.md) | 中文

## Problem
已发布 Web Chat 视图的三个缺陷，均在 `127.0.0.1:3081` 的已安装运行时上复现。

**已物化的 prompt 节点在折叠过程中被撤回。** `request-prompt.start` 通过 Context reader 记录对前一条 `request/header` 的依赖。当前插页面揭示出该前驱时，Context 被重放，`showsPrompt` 翻为 false，而 `buildViewNode` 在 `ConversationNodeAssembler` 仍持有已物化节点的情况下返回 `null`。`buildTargetUpserts` 拒绝这种撤回并抛错；异常从 `BoundConversation.accept` 逃逸到 Session 的事件流发布路径，导致该 Session 之后每一次折叠都失败。视图冻结：已渲染节点数停在 329，控制台反复出现 `[session-controller] event feed subscriber failed: conversation Definition "request-prompt" withdrew materialized target "chat"`，流式分片与请求的更早页面都不再出现。

**保存的阅读位置活过了它的 Session。** ui-chat apply 中的 `chatScrollPositions` 为每个 Session 在整个页面生命周期内保留一个位置。离开 Session 再重新打开会恢复该位置，于是长会话重新打开时停在旧历史，而不是实时尾部。

**读者上方的内容增长释放了贴底所有权。** 会话折叠分批物化窗口。浏览器的滚动锚定会随插入视口上方的内容推进 `scrollTop`，而延迟的滚动采样把这段位移归因于读者，从而释放跟随；在一个很大的运行中 Session 上，视图最终停在距尾部 2 974 px 处。

## Decision
`request-prompt.buildViewNode` 在节点一旦存在后保持其物化：当 `showsPrompt` 为 false 或记录的 prompt 为空，且 `context.current` 已持有节点时，返回同一 key 且 `visibility: 'hidden'` 的节点。首次物化之前仍返回 `null`，未变化的 prompt 行因此仍不出现在 transcript 中。

保存的阅读位置只在其 Session 为当前会话期间存在。ui-chat 的 apply effect 在当前 Session 变化时删除该条目，因此从列表重新打开的 Session 落在实时尾部，而同一 Session 内切换 Conversation 视图仍会恢复读者的位置。

`ChatView` 唯一的 ResizeObserver 在贴底所有权保持时即使存在待处理的滚动采样也会跟随内容增长，除非在 `READER_GESTURE_WINDOW_MS`（1 秒）内出现过可信的读者手势（`wheel`、`touchstart`、`touchmove`、`pointerdown`、`keydown`）。采样时刻的所有权判定仍来自 [observed-top ledger](2026-08-06-reader-scroll-attribution-observed-top-ledger.zh.md)；手势时间窗只避免内容增长把自身位移尚未归因的读者拽走。

## Alternatives considered
**在 `ConversationNodeAssembler` 中容忍撤回。** 否决：正是这条响亮契约暴露了 Definition 的缺陷，而 `assistant.ts` 已为自己的内容消失带有「隐藏而非撤回」的守卫。放宽引擎会掩盖下一个违反同一规则的 Definition。

**跨 Session 切换保留保存的阅读位置。** 否决：重新打开长会话必须显示最新内容；该位置声明的用途是同一 Session 内的 Conversation 视图切换。

**用可见内容身份而不是手势来归因交付的位置。** 否决：`pagingAnchor` 读取的是 jsdom 不提供的布局，而可见行身份正是前插路径已经拥有的信号；手势时间戳只回答「采样待处理」这一个问题。

**仅按滚动高度增长来判定位置推进。** 否决：读者在 transcript 流式输出期间滚动会产生同样的正向差值，贴底视图会与读者对抗。

## Consequences
丢失可见内容的 Definition 会保留一个隐藏节点，因此揭示前驱 header 的前插不会再杀死折叠；Chat transcript 不再冻结某个 Session，流式分片与已加载的历史页面继续渲染。从列表打开的 Session 无论此前阅读位置如何都显示实时尾部。贴底读者在折叠完成期间保持在尾部。

覆盖：`conversation-node-definitions.client.spec.ts` 固定隐藏节点重放以及后续 append 仍然落地；`apply-inject.client.spec.tsx` 固定位置生命周期；`chat-view.client.spec.tsx` 固定贴底跟随与读者手势守卫。聚焦的 ui-chat 套件（318 个测试）、`pnpm run test:gui`（3 929 个测试）与 `tsc -b packages/client/ui-chat` 通过。已安装运行时的真实验证：打开大会话产生零控制台错误并渲染 1 065 个节点，`Load older` 把窗口增长到 2 377 个节点，滚动离开后切换 Session 再打开落在底部，运行中的 Session 在折叠完成期间始终保持贴底。
