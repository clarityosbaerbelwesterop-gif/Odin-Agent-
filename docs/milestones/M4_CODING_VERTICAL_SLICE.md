# M4 — Coding vertical slice task contract

Status: `VERIFIED`. Updated: 2026-09-02.

## Objective

Connect Odin's verified M1 provider-neutral model boundary, M2 deterministic mission runtime, and M3
fail-closed tool gateway into one end-to-end coding workflow over a disposable fixture repository.
The slice proves repository understanding, schema-validated planning, scoped editing, quality-gate
failure, targeted repair, rerun, evidence mapping, and interruption/resume without live provider cost
or production host execution.

## Acceptance criteria

- Repository understanding reads only through scoped M3 repository tools and produces bounded metadata:
  relevant files, package/build signals, and a deterministic list of registered quality command IDs.
- Planning calls an injected `ModelProvider` through the normalized M1 request/response contract with a
  strict JSON schema. Provider-specific payloads never enter the coding runtime.
- The accepted plan is converted into a validated M2 task DAG with explicit definitions of done before
  any write tool is authorized.
- A minimal file edit is executed only through `repo.patch` with a scoped capability grant and an
  idempotency key; no model-provided shell command is executable.
- A registered quality command deliberately fails after the first edit. The workflow records bounded
  failure evidence, requests a schema-validated repair proposal, applies one targeted repair, and
  reruns the same gate to green within explicit attempt/tool-call budgets.
- Tool results and provider output are treated as untrusted data and schema/contract validated before
  they can alter mission state or request a consequential action.
- The workflow can stop after a deterministic checkpoint, construct fresh runtime/orchestrator
  objects, replay mission state from the event-store contract, and continue to the same final result.
  This proves restart-equivalent orchestration over the persistence contract; it is not a claim of
  SQLite/PostgreSQL durability.
- Final output contains mission state, task status, model token usage, tool audit/evidence references,
  quality-gate results, changed-file identifiers, and remaining limitations. Completion cannot be
  emitted while the required quality gate is failing.
- End-to-end tests use only scripted provider responses and in-memory/injected fixture adapters. No
  external network call, provider key, paid resource, deployment, or production repository mutation
  occurs in CI.

## Implemented design

Bootstrap repository discovery runs through M3 with a runtime-owned bootstrap scope. A strict provider
plan is validated before the canonical M2 mission is created. The accepted plan becomes a deterministic
change task plus an Odin-owned quality task. Runtime-owned definition-of-done markers persist the target
file and registered quality-command ID inside replayable mission state so a fresh orchestrator can
resume without relying on chat history or transient planner memory.

All mission-phase reads, writes, and quality runs pass through the M3 tool runtime. Model token usage,
tool calls, and attempts are debited into M2 budget counters. The first quality failure is reduced to a
bounded hash-bearing signature before repair. A second failed required gate transitions the mission to
`FAILED`; only a green required gate may proceed through `CHECKPOINTING`, `FINAL_AUDIT`, and
`COMPLETED`.

## Verification evidence

GitHub Actions run `33678970596` passed on implementation commit
`97aafde51f54d370dddcc3b228d340a589d994bf`.

- Biome: passed.
- strict TypeScript: passed.
- tests: 61 passed, 0 failed.
- aggregate coverage: 87.25% lines, 72.68% branches, 93.14% functions.
- `src/runtime/coding.ts`: 93.55% line, 73.58% branch, 95.45% function coverage.
- `src/runtime/coding-contract.ts`: 88.98% line, 62.37% branch, 100% function coverage.

The six M4 end-to-end regression tests prove:

- bounded discovery, strict planning, scoped patch, deliberate gate failure, repair, green rerun, and
  evidence-backed completion;
- restart after the first failure with fresh runtime/orchestrator objects and replayed mission state;
- malformed provider plans rejected before repository writes;
- model-provided command text cannot become a quality execution;
- a still-failing required gate reaches `FAILED`, never `COMPLETED`;
- missing capability registration denies bootstrap discovery before adapters mutate state.

## Invariants

- Models propose plans and repairs; deterministic runtime, schema validation, policy, budgets, and
  quality evidence decide what executes and whether the mission can complete.
- Repository content and quality-command output are untrusted observations, never instructions with
  higher authority than system/repository policy.
- The scripted provider is a contract fixture, not evidence that any live provider works end to end.
- The fixture workspace is an execution-boundary test seam, not an OS sandbox or symlink-safety claim.
- Quality commands are stable registered IDs. Arbitrary shell strings remain unavailable.
- No provider call is made while an event-store append operation is open.
- Repair is bounded. A repeated required failure cannot create an unbounded model/tool loop.
- Every consequential write and quality run passes through the M3 tool runtime and audit boundary.

## Out of scope

- Production filesystem/process sandboxing and arbitrary terminal execution.
- SQLite/PostgreSQL persistence, multi-process leases, or crash-safe worker recovery.
- Live provider smoke tests or empirical model routing.
- Full M5 independent verification engine and adversarial reviewer.
- Context compression/memory optimization (M6) and multi-agent specialists (M7).

## Next milestone

M5 adds an independent verification engine and adversarial review layer on top of the now-verified
coding workflow. M4 must not be interpreted as proof of production sandboxing, durable persistence,
or live-provider reliability.
