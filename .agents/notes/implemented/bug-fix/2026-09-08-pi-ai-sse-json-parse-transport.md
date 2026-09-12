# Agent Note: Classify mid-stream SSE JSON parse failures as transport errors

Status: implemented

English | [中文](2026-09-08-pi-ai-sse-json-parse-transport.zh.md)

## Problem
OpenAI-responses proxies that emit SSE event frames without the required blank-line separators make the OpenAI SDK coalesce consecutive events into one `data` blob; its `JSON.parse` then throws `Unexpected non-whitespace character after JSON at position …` mid-stream. `classifyPiAiError` matched none of its patterns and returned the non-retryable `PI_AI_ERROR`, so an in-flight turn died instead of resending.

## Decision
`classifyPiAiError` maps the V8 `JSON.parse` failure wordings (`Unexpected non-whitespace character after JSON …`, `Unexpected end of JSON input`, `Unexpected token … is not valid JSON`) to `TRANSPORT`. These messages only arise when the wire delivered malformed framing, so the provider's bounded retry policy becomes the recovery path. Deliberate provider error bodies keep their existing classifications because the new patterns match only SDK parse wording.

## Alternatives considered
**Tolerate missing blank lines in DSH's own SSE parsing.** The parsing lives in the vendored OpenAI SDK inside pi-ai; reimplementing the decoder would duplicate owned transport code and diverge from the SDK's behavior for every other provider.

**Classify as `SERVER` instead of `TRANSPORT`.** Both codes are retryable by default, but the failure is a framing defect on the wire, not a remote processing error; `TRANSPORT` keeps provider health signals meaningful.

## Consequences
A proxy whose SSE framing intermittently degrades now yields bounded retries instead of a failed turn. The behavior is covered by the `maps pi-ai transport wording` cases in `convert.spec.ts`; the focused llm-pi-ai suite passes.
