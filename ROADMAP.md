# Odin delivery roadmap

Checkboxes mean verified repository evidence, not intent. Milestones are completed sequentially;
later design work may occur early, but later product capability is not declared complete early.

## M0 — Repository foundation

- [x] Research source read and architecture observations extracted.
- [x] Empty-repository baseline and branch state established.
- [x] Product contract, architecture, security, contributor rules, and handover created.
- [x] ADR process and initial architecture decisions recorded.
- [x] Locked Node/TypeScript toolchain and secret-safe environment example created.
- [x] Pull-request CI and deterministic foundation validation established.
- [x] CI result observed on the pull request.

Exit gate: clean install plus `npm run verify` passes locally and in CI; documentation agrees with
the repository; no product capability is overstated.

## M1 — Provider core

- [x] Normalized request, response, streaming, usage, tool-call, and error contracts.
- [x] Capability registry with config overrides and provenance.
- [x] OpenAI, Anthropic, OpenRouter, NVIDIA, and generic compatible adapters.
- [x] Abort, timeout, retry hints, rate limit, malformed output, and context overflow handling.
- [x] Injected-transport contract tests with no live cost.

## M2 — Mission runtime

- [x] Mission aggregate, typed state machine, task DAG, focus classification, and definitions of done.
- [x] Deterministic scheduler, budgets, retries, pause/resume/cancel, and anti-loop circuit breaker.
- [x] Append-only events, projections, checkpoints, optimistic versions, and recovery tests.

## M3 — Tool runtime

- [x] Tool registry and progressive discovery foundation; full skill package lifecycle remains M10.
- [x] Schema validation, risk classes, capability policy, idempotency, timeout, retry, and audit trail.
- [x] Scoped repository search/read/patch and quality-command tools.

## M4 — Coding vertical slice

- [x] Repository understanding and quality-gate discovery through scoped M3 tools.
- [x] Strict plan and task graph generated through the normalized M1 provider boundary.
- [x] Minimal scoped edit in an injected disposable fixture workspace.
- [x] Deliberate quality failure diagnosed, repaired, rerun, and mapped to evidence.
- [x] Interruption/resume demonstrated end to end over replayed M2 event-store state.

M4 proves orchestration across the M1/M2/M3 contracts with scripted provider responses and injected
in-memory fixtures. It does not claim a production OS sandbox, live-provider compatibility, or durable
SQLite/PostgreSQL recovery.

## M5 — Verification engine

- [x] Typed claim/evidence/binding contracts and deterministic fail-closed verifier.
- [x] Independent adversarial review with validated `ACCEPT`, `BLOCK`, and bounded
  `REPAIR_REQUIRED` outcomes.
- [x] M4 completion gated by fresh, scoped, hash-addressed M5 evidence.
- [x] Required verifier and coding-integration regression scenarios pass.
- [x] Pull-request implementation CI result observed and recorded.

GitHub Actions run `33724426019` passed on M5 implementation head
`f28bcb9758c2079d9f46826ea672c19bd6e538ff` with 77 tests and all configured gates.

## M6 — Memory and context engine

- [x] Scoped/versioned memory contracts and asynchronous in-memory adapter.
- [x] Optimistic concurrency, idempotency, expiry, tombstones, and bounded deterministic retrieval.
- [x] Fixed P0–P6 source priorities, current-source precedence, and mandatory P0–P2 context.
- [x] Deterministic item/section/total token estimates and fail-closed budget handling.
- [x] Bounded content-addressed cache with sensitive-data exclusion and memory invalidation.
- [x] Structured, integrity-checked session snapshots retaining raw-history references.
- [x] Retrieval-to-context vertical slice and requirement-derived regression tests.
- [x] Implementation CI observed: run `33752964771`, 108/108 tests passed.
- [x] Synchronized documentation CI observed: run `33753281792`; final evidence recorded.

## M7–M12

- [ ] M7 isolated specialists, ownership, and reconciliation.
- [ ] M8 persistent workers, event fan-out, reconnect, and long-running recovery.
- [ ] M9 responsive web client and native-client protocol strategy.
- [ ] M10 progressively loaded, permissioned, independently tested skills.
- [ ] M11 empirical model routing, caching, concurrency, and cost optimization.
- [ ] M12 security/load/recovery hardening, backups, observability, and eval release gates.

## MVP definition of done

MVP requires a user-supplied provider key, workspace, complex coding request, automatic plan and task
graph, targeted repository retrieval, scoped edits, tests, diagnosis and repair, durable mission
resume, token/cost display, and an evidence-backed final report. A mock-only demonstration does not
satisfy MVP.
