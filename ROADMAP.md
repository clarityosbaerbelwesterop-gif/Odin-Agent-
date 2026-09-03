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
in-memory fixtures. It does not claim a production OS sandbox or live-provider compatibility.

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

## M7 — Specialist coordination

- [x] Bounded specialist registry with compact discovery metadata and injected handlers.
- [x] M2 dependency-ready task selection plus deterministic role/capability matching.
- [x] Expiring repository/resource/state ownership leases with read/write conflict detection.
- [x] Bounded parallel execution, timeout/cancellation cleanup, and partial-failure preservation.
- [x] Strict structured proposal validation and runtime-attested evidence reconciliation.
- [x] Implementation CI observed: run `33755851793`, 132/132 tests passed.
- [x] Synchronized documentation CI observed: run `33756217402`; final M7 evidence recorded.

## M8 — Durable missions and worker recovery

- [x] Node 24 SQLite adapter persists canonical M2 mission events with optimistic versions,
  mission-scoped idempotency, canonical UTC metadata, bounded JSON, hashes, and fail-closed replay.
- [x] Derived mission checkpoints persist across close/reopen, reject regression/conflict/corruption,
  and reproduce from canonical events before acceptance.
- [x] Durable jobs provide deterministic atomic claims, bounded attempts, expiring fenced leases,
  hashed opaque lease tokens, retries, cancellation, and terminal blocking on exhaustion.
- [x] Runtime-owned worker timeout, heartbeat, cooperative cancellation, structured settlement, and
  secret-safe error normalization are implemented with injected handlers.
- [x] Mission-scoped lifecycle events expose strictly increasing reconnect cursors and validate hashes.
- [x] Crash/reopen recovery reclaims expired in-flight work at a higher generation and rejects stale
  settlement; a 32-job fixture proves bounded retry/block/cancel/reopen draining.
- [x] Implementation CI observed: run `33766277108`, 149/149 tests passed; aggregate coverage was
  88.91% lines, 76.49% branches, and 95.24% functions.

M8 proves local SQLite restart durability and at-least-once worker delivery. It does not claim hosted
queue semantics, PostgreSQL/service durability, exactly-once external effects, cross-host fencing,
process/container/worktree isolation, or a production sandbox.

## M9 — Client protocol and responsive web shell

- [x] Versioned strict client request/response contracts with bounded user-facing mission projections.
- [x] Runtime-scoped read/command capabilities and exact pause/resume/cancel control only.
- [x] Optimistic expected-version commands plus durable mission-scoped idempotency and stale replay denial.
- [x] Bootstrap and reconnect over M8 lifecycle cursors with deterministic reducer replay and tamper checks.
- [x] Framework-free accessible responsive web fixture for mission state, tasks, budgets, workers,
  verification, reconnect state, and deliberate cancellation.
- [x] One protocol strategy documented for web, iOS/iPadOS/macOS, and Android clients without moving
  canonical long-running state onto devices.
- [x] Implementation CI observed: run `33773644733`, 161/161 tests passed; aggregate coverage was
  89.31% lines, 76.56% branches, and 95.41% functions.

M9 proves the local protocol/controller/reconnect/UI contract. It does not claim a public HTTP service,
authentication, WebSocket/SSE transport, production hosting, push notifications, or native binaries.

## M10–M12

- [ ] M10 progressively loaded, permissioned, independently tested skills.
- [ ] M11 empirical model routing, caching, concurrency, and cost optimization.
- [ ] M12 security/load/recovery hardening, backups, observability, and eval release gates.

## MVP definition of done

MVP requires a user-supplied provider key, workspace, complex coding request, automatic plan and task
graph, targeted repository retrieval, scoped edits, tests, diagnosis and repair, durable mission
resume, token/cost display, and an evidence-backed final report. A mock-only demonstration does not
satisfy MVP.
