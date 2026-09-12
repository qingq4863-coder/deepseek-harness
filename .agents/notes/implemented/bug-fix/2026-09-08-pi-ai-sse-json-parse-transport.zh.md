# Agent Note: 将流中 SSE JSON 解析失败归类为传输错误

Status: implemented

[English](2026-09-08-pi-ai-sse-json-parse-transport.md) | 中文

## 问题
OpenAI-responses 代理若发出的 SSE 事件帧之间缺少必需的空行分隔，OpenAI SDK 会把连续事件合并成一个 `data` 块，其 `JSON.parse` 随即在流中途抛出 `Unexpected non-whitespace character after JSON at position …`。`classifyPiAiError` 的既有模式均不匹配，返回了不可重试的 `PI_AI_ERROR`，导致进行中的回合直接失败而不是重新发送。

## 决策
`classifyPiAiError` 将 V8 的 `JSON.parse` 失败措辞（`Unexpected non-whitespace character after JSON …`、`Unexpected end of JSON input`、`Unexpected token … is not valid JSON`）映射为 `TRANSPORT`。这些消息只在线路上送达了错误帧时出现，因此供应商的有界重试策略成为恢复路径。刻意的供应商错误正文保持既有分类，因为新模式只匹配 SDK 的解析措辞。

## 备选方案
**在 DSH 自己的 SSE 解析中容忍缺失空行。** 解析逻辑位于 pi-ai 内置的 OpenAI SDK 中；自行重写解码器会复制受维护的传输代码，并与其他所有供应商的 SDK 行为产生分歧。

**归类为 `SERVER` 而非 `TRANSPORT`。** 两者默认都可重试，但该失败是线路上的帧缺陷而非远端处理错误；`TRANSPORT` 能保持供应商健康信号的语义。

## 结果
SSE 帧质量间歇性劣化的代理现在产生有界重试而不是失败回合。行为由 `convert.spec.ts` 的 `maps pi-ai transport wording` 用例覆盖；llm-pi-ai 定向套件通过。
