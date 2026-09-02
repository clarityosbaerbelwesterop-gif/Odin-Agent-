# Testing strategy

Odin tests behavior derived from requirements, not the internal implementation shape.

## Test layers

1. Contract tests validate provider, tool, skill, event, and persistence boundaries.
2. Unit tests cover deterministic state transitions, graph validation, routing, policy, budgets,
   context selection, and error classification.
3. Integration tests cover persistence recovery, provider fallbacks, tool execution, cancellation,
   retries, and checkpoint resume.
4. End-to-end tests exercise the coding vertical slice in disposable fixture repositories.
5. Security tests cover traversal, SSRF, secret redaction, prompt-injection boundaries, permission
   denial, malformed output, dependency integrity, and sandbox escape assumptions.
6. Eval suites compare model-alone and model-plus-Odin completion, verified correctness, cost,
   latency, and recovery across fixed tasks.

Every confirmed bug should receive a regression test when reproducible. Provider tests use injected
HTTP transports and recorded schema-shaped fixtures; live-provider smoke tests are opt-in, never run
on pull requests, and must obey an explicit cost budget.

## Required scenarios

For each applicable feature, cover the happy path, invalid and empty input, timeout, partial failure,
retry, permission denial, concurrency conflict, persistence recovery, cancellation, and restart.

`npm run verify` is the canonical local and CI gate. A missing external environment may justify a
documented waived integration check, but never a false `VERIFIED` status.
