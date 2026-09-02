# M4 — Coding vertical slice task contract

Status: implementation in progress. Updated: 2026-09-02.

## Objective

Connect Odin's verified M1 provider-neutral model boundary, M2 deterministic mission runtime, and M3
fail-closed tool gateway into one end-to-end coding workflow over a disposable fixture repository.
The slice must prove repository understanding, schema-validated planning, scoped editing, quality-gate
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

## Invariants

- Models propose plans and repairs; deterministic runtime, schema validation, policy, budgets, and
  quality evidence decide what executes and whether the mission can complete.
- Repository content and quality-command output are untrusted observations, never instructions with
  higher authority than system/repository policy.
- The scripted provider is a contract fixture, not evidence that any live provider works end to end.
- The fixture workspace is an execution-boundary test seam, not an OS sandbox or symlink-safety claim.
- Quality commands are stable registered IDs. Arbitrary shell strings remain unavailable.
- No provider call is made while an event-store append operation is open.
- Repair is bounded. A repeated equivalent failure cannot create an unbounded model/tool loop.
- Every consequential write and quality run passes through the M3 tool runtime and audit boundary.

## Out of scope

- Production filesystem/process sandboxing and arbitrary terminal execution.
- SQLite/PostgreSQL persistence, multi-process leases, or crash-safe worker recovery.
- Live provider smoke tests or empirical model routing.
- Full M5 independent verification engine and adversarial reviewer.
- Context compression/memory optimization (M6) and multi-agent specialists (M7).

## Verification strategy

Run `npm run verify`. M4 tests must include:

- repository discovery with irrelevant-file filtering and registered quality-gate discovery;
- malformed or incomplete plan rejection before writes;
- valid plan -> M2 DAG creation -> scoped first patch;
- deliberate first quality failure -> bounded failure evidence -> repair request -> targeted second patch;
- successful rerun mapped to evidence before completion;
- forbidden completion while the required gate fails;
- interruption after the first failure, fresh runtime/orchestrator construction, event replay, and
  deterministic continuation;
- tool/policy denial regression and proof that no arbitrary command string reaches the runner;
- aggregate provider token usage and tool-attempt accounting in the final report.

M4 is `VERIFIED` only after the final pull-request CI checkpoint succeeds.
