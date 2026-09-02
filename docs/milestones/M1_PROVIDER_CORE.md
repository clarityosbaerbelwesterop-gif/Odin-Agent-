# M1 — Provider core task contract

Status: verified locally. Updated: 2026-09-02.

## Objective

Provide one provider-neutral boundary for model inference without coupling mission logic to a vendor.
Support OpenAI Responses, Anthropic Messages, OpenRouter Chat Completions, NVIDIA NIM Chat
Completions, and explicitly configured OpenAI-compatible endpoints.

## Acceptance criteria

- Normalized messages, tools, structured output, reasoning controls, usage, finish reasons, errors,
  and streaming events are provider-independent.
- Every charged request is rejected locally when its configured capability profile cannot satisfy it.
- Model capability records carry explicit provenance and can be replaced by user configuration.
- Credentials are resolved only after validation and are never included in normalized errors.
- HTTP redirects are denied, response sizes are bounded, abort/timeout signals propagate, and SSE is
  parsed across arbitrary chunks.
- Provider tests use injected transports and synthetic responses; CI never requires a provider key.

## Invariants

- Provider names and model names do not stand in for capabilities.
- Adapters translate protocols; they do not own retries, fallback, routing, budgets, or mission state.
- Unknown or absent capability metadata fails closed.
- Provider error bodies are treated as untrusted data and are bounded before parsing.
- No live model request is part of verification.

## Out of scope

- Empirical model routing and price optimization (M11).
- Runtime retry/backoff and provider fallback policy (M2).
- Tool execution (M3), even though tool-call payloads are normalized here.
- Persistent usage/cost records (M2/M8).

## Primary protocol references

Checked on 2026-09-02:

- [OpenAI Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI streaming responses](https://developers.openai.com/api/docs/guides/streaming-responses)
- [Anthropic Messages](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)
- [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [OpenRouter API overview](https://openrouter.ai/docs/api-reference/overview)
- [OpenRouter streaming](https://openrouter.ai/docs/api-reference/streaming)
- [NVIDIA NIM API reference](https://docs.api.nvidia.com/nim/reference)

## Verification

Run `npm run verify`. Contract tests must cover request translation, response normalization,
fragmented streams, comments and multiline SSE fields, final usage-only chunks, capability denial,
rate-limit hints, malformed output, aborts, and credential redaction.

Local evidence: 29 tests passed; TypeScript, Biome, build, and foundation gates passed; aggregate
coverage was 81.60% lines, 88.46% functions, and 68.81% branches. Pull-request CI must still confirm
this commit before the checkpoint is considered remotely verified.
