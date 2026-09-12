# Agent Note: Keep the Chat fold alive and a reopened Session at its live tail

Status: implemented

English | [中文](2026-09-09-chat-fold-and-reopen-tail.zh.md)

## Problem
Three defects in the shipped Web Chat view, reproduced against the installed runtime at `127.0.0.1:3081`.

**A materialized prompt node was withdrawn mid-fold.** `request-prompt.start` records a dependency on the preceding `request/header` through the Context reader. When a prepended page revealed that predecessor, the Context was replayed, `showsPrompt` flipped to false, and `buildViewNode` returned `null` while `ConversationNodeAssembler` still held the materialized node. `buildTargetUpserts` refuses that withdrawal and throws; the throw escaped `BoundConversation.accept` into the Session event-feed publication, so every later fold for that Session failed. The view froze: the rendered node count stayed at 329, `[session-controller] event feed subscriber failed: conversation Definition "request-prompt" withdrew materialized target "chat"` repeated in the console, and neither streaming chunks nor a requested older page ever appeared.

**A saved reader position outlived its Session.** `chatScrollPositions` in ui-chat's apply kept one position per Session for the page lifetime. Leaving a Session and reopening it restored that position, so a long Session reopened at old history instead of its live tail.

**Content growth above the reader released bottom ownership.** The conversation fold materializes a window in batches. Browser scroll anchoring advances `scrollTop` with content inserted above the viewport, and the deferred scroll sample attributed that movement to the reader, releasing follow; the view settled 2 974 px above the tail on a large running Session.

## Decision
`request-prompt.buildViewNode` keeps the Context's node materialized once it exists: when `showsPrompt` is false or the recorded prompt is empty and `context.current` already holds a node, it returns the same key with `visibility: 'hidden'`. It still returns `null` before first materialization, which is what leaves an unchanged prompt row out of the transcript.

The saved reader position lives only while its Session is current. The ui-chat apply effect deletes the entry when the current Session changes, so a Session reopened from the list lands on the live tail while a Conversation-view switch inside one Session still restores the reader's place.

`ChatView`'s single ResizeObserver follows content growth while bottom ownership is pinned even when a scroll sample is pending, unless a trusted reader gesture (`wheel`, `touchstart`, `touchmove`, `pointerdown`, `keydown`) arrived within `READER_GESTURE_WINDOW_MS` (1 s). Ownership at sample time still comes from the [observed-top ledger](2026-08-06-reader-scroll-attribution-observed-top-ledger.md); the gesture window only keeps content growth from yanking a reader whose own move has not been attributed yet.

## Alternatives considered
**Tolerate withdrawal in `ConversationNodeAssembler`.** Rejected: the loud contract is what surfaced the Definition defect, and `assistant.ts` already carries the hidden-instead-of-withdrawn guard for its own disappearing content. Softening the engine would hide the next Definition that breaks the same rule.

**Keep a Session's saved position across Session switches.** Rejected: reopening a long Session must show its newest content; the position's stated purpose is a Conversation-view switch inside one Session.

**Attribute the delivered position by visible-content identity instead of gestures.** Rejected: `pagingAnchor` reads layout jsdom does not provide, and the visible-row identity is the same signal the prepend path already owns; the gesture timestamp answers only the pending-sample question.

**Classify the position advance by scroll-height growth alone.** Rejected: a reader scrolling while the transcript streams produces the same positive deltas, and the pinned view would fight them.

## Consequences
A Definition that loses its visible content keeps a hidden node, so the fold survives a prepend that reveals a predecessor header; the Chat transcript no longer freezes a Session, and streaming chunks and loaded history pages keep rendering. A Session opened from the list shows its live tail regardless of an earlier reading position. A pinned reader stays at the tail while the fold completes.

Coverage: `conversation-node-definitions.client.spec.ts` pins the hidden-node replay and a later append still landing; `apply-inject.client.spec.tsx` pins the position lifetime; `chat-view.client.spec.tsx` pins the pinned-follow case and the reader-gesture guard. The focused ui-chat suite (318 tests), `pnpm run test:gui` (3 929 tests), and `tsc -b packages/client/ui-chat` pass. Live verification against the installed runtime: opening the large Session produced zero console errors and 1 065 rendered nodes, `Load older` grew the window to 2 377 nodes, a scroll-away plus Session switch reopened at the floor, and a running Session stayed pinned through fold completion.
