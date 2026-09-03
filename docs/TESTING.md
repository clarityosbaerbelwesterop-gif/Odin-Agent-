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

M5 verification fixtures derive claims from definitions of done and exercise valid evidence, missing
bindings, canonical time/freshness, foreign scope, failed and contradictory observations, reuse,
weak/self-authored provenance, malformed reviewer results, bounded repair requests, deterministic
replay, and the M4 completion gate. A green quality command alone is explicitly insufficient.

M7 coordination fixtures use injected deterministic workers only. They cover dependency readiness,
stable selection and hashes, missing specifications/capabilities, batch/global/worker capacity,
read/write ownership across repository/resource/state namespaces, active/expired/cross-plan leases,
clock rollback, plan tampering/replay, strict result validation, runtime evidence attestation,
unowned writes, partial failure, timeout/cancellation cleanup, and a two-worker barrier that would
time out under accidental sequential execution.

Every confirmed bug should receive a regression test when reproducible. Provider tests use injected
HTTP transports and recorded schema-shaped fixtures; live-provider smoke tests are opt-in, never run
on pull requests, and must obey an explicit cost budget.

## Required scenarios

For each applicable feature, cover the happy path, invalid and empty input, timeout, partial failure,
retry, permission denial, concurrency conflict, persistence recovery, cancellation, and restart.

`npm run verify` is the canonical local and CI gate. A missing external environment may justify a
documented waived integration check, but never a false `VERIFIED` status.

The current test runner enforces aggregate minimums of 80% line coverage, 80% function coverage,
and 60% branch coverage. Coverage is a regression signal, not evidence that behavior is correct;
the scenario and contract assertions above remain authoritative.
