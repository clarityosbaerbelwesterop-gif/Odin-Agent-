# Odin architecture

Status: M8 durable missions and worker recovery verified, 2026-09-03.

## Repository finding

The repository began with one README line and no implementation, tests, CI, security policy, or
prior architecture. Odin therefore started as a greenfield system. The first product slice remains a
strict TypeScript modular monolith: boundaries are explicit, but deployment is not split into
speculative microservices.

## System invariants

1. Durable mission state, not conversation history, is canonical.
2. The model proposes; deterministic runtime and policy decide what executes.
3. Important work cannot become complete without mapped verification evidence.
4. Execution is scoped, interruptible, budgeted, and deny-by-default.
5. Provider, tool, skill, memory, persistence, worker, and client protocols are versioned boundaries.
6. External content, repository content under analysis, tool output, model output, and worker output are untrusted.
7. Credentials remain in the trusted control plane and are never placed in model context.
8. Every state transition and consequential side effect is auditable without storing hidden reasoning.
9. Context is compiled progressively from state and artifacts; raw history remains recoverable.
10. Quality-per-cost is measured, but cost optimization may not silently violate required quality.
11. Specialists propose bounded work; the runtime retains scheduling, ownership, acceptance, and settlement.
12. Local durability is not distributed correctness: SQLite recovery never implies exactly-once external effects.

## Logical architecture

```text
Clients
  -> API and realtime gateway
     -> Mission service and policy
        -> Agent runtime and scheduler
           -> Planner / model router / context compiler
           -> Tool gateway -> isolated workers
           -> Verifier and repair loop
        -> Event store / checkpoints / durable jobs / artifacts / memory
```

### Trusted control plane

Owns identity, sessions, missions, permissions, budgets, provider configuration, secret brokering,
worker leases, canonical events, approvals, persistence, and client fan-out. It does not load
arbitrary plugins in-process.

### Cognitive runtime

Owns task classification, planning effort, dependency-aware task graphs, context compilation,
provider-independent model requests, verification strategy, evidence collection, targeted repair,
and final audit. It cannot bypass policy or mark itself complete without required evidence.

### Execution plane

Runs filesystem, terminal, browser, repository, and programmatic-workflow tools behind policy and
isolation boundaries. Host execution and unrestricted network access are never defaults.

M3 implements the control boundary in front of execution, not the production worker sandbox. Tool
calls are schema-validated, policy-checked, bounded, idempotent where side effects are possible, and
audited before injected repository adapters are reached. Arbitrary shell and network execution remain
unimplemented.

### Knowledge and persistence plane

Stores canonical mission events, validated checkpoints, durable job state, lifecycle cursors,
versioned artifacts, working/project/user memory, skill packages, provenance, and eval outcomes.
Repository state and current primary evidence override remembered facts.

M8 implements the first durable local state adapter with Node 24 `node:sqlite`. Canonical mission
events remain source of truth. Checkpoints are derived and must reproduce from canonical events.
Worker jobs are durable orchestration state with at-least-once semantics and fenced settlement.

### Experience layer

Begins with a responsive web client against the same versioned protocol later used by iOS/iPadOS/
macOS and Android clients. Clients are observers/controllers, not the source of mission truth.

## Implemented M1–M3 core boundaries

`src/providers` implements normalized request, response, usage, tool-call, structured-output,
streaming, and typed-error contracts for OpenAI, Anthropic, OpenRouter, NVIDIA, and compatible
providers. Unknown capabilities fail before credentials resolve. Protocol behavior is tested through
injected transports; live provider end-to-end compatibility is not claimed.

`src/mission` and `src/events` implement the deterministic M2 control core: closed mission states,
validated task DAGs, deterministic scheduling, integer budgets, bounded failure circuits, append-only
event projection, optimistic aggregate versions, idempotent batches, checkpoints, and replay.

`src/tools` implements the M3 fail-closed tool gateway. Registrations expose compact metadata
separately from handlers. Inputs are strict-schema validated; capability grants scope mission/task/
tool/operation/resource/call ceilings/expiry; high-impact calls require approval evidence. Repository
search/read/patch/quality operations use injected adapters, and no model-provided shell string is
accepted.

## Implemented M4 coding vertical slice

`src/runtime/coding.ts` and `src/runtime/coding-contract.ts` connect M1, M2, and M3 in a fixture-backed
workflow. Runtime-owned discovery finds bounded relevant files and registered quality-command IDs,
an injected provider emits a strict plan, and the plan is rejected unless it matches discovery and a
valid M2 task graph.

Repository reads/patches/quality gates pass through M3. Provider/tool usage debits M2 budgets. A
required quality failure produces bounded diagnosis and repair; repeated failure prevents completion.
The workflow can checkpoint after failure, reconstruct fresh runtime/orchestrator objects, replay the
same mission state, and continue without repeating the original patch.

M4 is orchestration proof, not a production sandbox or live-provider proof.

## Implemented M5 verification authority

`src/verification` is a non-mutating authority between execution evidence and completion. It validates
bounded typed claims, evidence, bindings, mission/task scope, timestamps, content hashes, freshness,
producer class, and required evidence coverage. Missing, malformed, stale, foreign, contradictory,
failed, duplicated, or weak evidence fails closed.

A separate adversarial review may `ACCEPT`, `BLOCK`, or return bounded `REPAIR_REQUIRED`. The coding
orchestrator cannot reach final completion without internally consistent verifier and reviewer pass
results. Verification stores concise references/hashes, not private reasoning.

## Implemented M6 memory and context slice

`src/memory` defines asynchronous contracts for working, episodic, semantic, project, and explicit
user-preference memory. The current adapter is in-memory and enforces scope, optimistic versions,
idempotency, provenance, expiry, tombstones, bounded retrieval, and deterministic ordering.

`src/context` assigns fixed P0–P6 source classes. Mandatory P0–P2 context cannot be silently removed;
current repository/state evidence wins conflicts over memory/history. The compiler accounts bounded
context with deterministic estimates and excludes sensitive compilations from cache. Session snapshots
preserve typed summaries plus a raw-event reference but are not signatures or durable storage.

## Implemented M7 specialist coordination slice

`src/coordination` adds bounded specialist discovery, dependency-ready assignment, logical repository/
resource/state ownership, concurrency ceilings, expiring in-process leases, worker cancellation, strict
proposal validation, runtime-owned evidence attestation, and deterministic reconciliation.

Each worker receives one immutable assignment and abort signal with no peer, mission, repository,
tool, policy, credential, or completion authority. M7 ownership remains a single-process logical-lock
contract and does not itself survive restart.

## Implemented M8 durable mission and worker slice

`src/durable` adds the first restart-safe local persistence and worker-job boundary:

- `SqliteDurableStore` implements the existing M2 `EventStore<MissionEventData>` contract using Node 24
  built-in SQLite with foreign keys, WAL, `synchronous=FULL`, bounded busy timeout, strict tables,
  explicit schema versioning, and short `BEGIN IMMEDIATE` transactions.
- Mission event batches enforce optimistic aggregate versions, mission-scoped idempotency fingerprints,
  bounded canonical JSON, contiguous sequence/version identity, canonical UTC timestamps, and
  fail-closed hashes/decoding across close/reopen.
- Mission checkpoints are versioned derived artifacts. Saves are idempotent, version regression and
  conflicting same-version content are denied, and reads validate the checkpoint hash plus reproduce
  the snapshot from canonical events.
- Durable jobs persist stable mission/task/job identity, priority, attempts, readiness, artifact
  references, lease generation, and lifecycle state. Raw prompts, repository contents, credentials,
  lease tokens, and raw worker errors are not persisted as job metadata.
- Claim order is deterministic and atomic. Each claim increments attempt and fencing generation,
  returns an opaque lease token, and stores only its SHA-256 hash. Heartbeat/settlement require the
  matching unexpired worker, generation, token, job, mission, and task.
- Expired work can be reclaimed at a higher generation while attempts remain; stale generations cannot
  settle. Exhaustion becomes `BLOCKED`. Running cancellation becomes `CANCELLING`, and cancellation
  defeats a late success proposal.
- `DurableJobRunner` owns timeout, heartbeat, cooperative cancellation observation, settlement, and
  error normalization. Handlers receive only an immutable lease/job envelope and `AbortSignal`.
- Typed hash-addressed lifecycle events expose mission-scoped strictly increasing cursors for reconnect.
  Corrupt lifecycle hashes fail closed instead of being skipped.
- Recovery tests reopen the SQLite file in a fresh store/runtime, replay mission/checkpoint state,
  reclaim an expired in-flight job at a higher generation, reject the stale completion, resume from a
  cursor, and deterministically drain a 32-job fixture with retry, block, cancellation, and final
  counts.

M8 proves local restart durability and at-least-once job delivery. It does **not** prove PostgreSQL or
hosted-queue durability, exactly-once external effects, cross-host/distributed fencing, leader election,
multi-region availability, artifact byte storage, worktree/process/container isolation, or sandbox
escape resistance.

## Current module map

```text
src/
  mission/       mission aggregate, task DAG, state machine, budgets, checkpoints
  events/        append-only event contracts and in-memory contract adapter
  providers/     normalized model API, capabilities, adapters, errors
  tools/         contracts, discovery, policy, audit, repository execution boundary
  runtime/       coding orchestrator, strict plan/repair, verification integration
  verification/  typed evidence verifier and adversarial review authority
  memory/        asynchronous memory contracts and in-memory adapter
  context/       retrieval facade, priority compiler/cache, session snapshots
  coordination/  specialist registry, logical ownership, bounded execution, reconciliation
  durable/       M8 SQLite mission events/checkpoints/jobs, lifecycle cursors, runner recovery
  routing/       empirical model/effort selection later
  artifacts/     content-addressed artifact byte/storage layer later
  cli/           first user-facing entry point later
```

An interface exists only when it protects a real substitution, trust boundary, or test seam. Local
single-user mode and future server mode use the same domain contracts but may use different
persistence and worker adapters.

## Next architecture milestone

M9 builds the responsive web client and native-client protocol strategy on top of M8's canonical
mission state and reconnect cursor. The client must remain a controller/observer: it cannot become the
source of mission truth, settle worker jobs, weaken M3 permissions, or bypass M5 completion evidence.

## Storage direction

Local mode now has a verified SQLite adapter for mission events, checkpoints, durable worker jobs, and
lifecycle cursors. Server/team mode may later add PostgreSQL or a hosted job transport behind the same
domain contracts. Events remain durable facts; projections and context summaries are rebuildable.
Large logs and outputs should become content-addressed artifacts referenced by hash rather than
embedded into mission/job records.

## Deployment direction

The MVP remains a modular service plus isolated worker process, not a fleet of microservices. Split a
component only when isolation, independent scaling, or failure containment is demonstrated. Mobile
clients never host the canonical long-running runtime.
