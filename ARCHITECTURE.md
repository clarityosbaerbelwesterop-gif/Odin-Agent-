# Odin architecture

Status: M5 verification-engine verified checkpoint, 2026-09-03.

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
5. Provider, tool, skill, memory, persistence, and client protocols are versioned boundaries.
6. External content, repository content under analysis, tool output, and model output are untrusted.
7. Credentials remain in the trusted control plane and are never placed in model context.
8. Every state transition and consequential side effect is auditable without storing hidden reasoning.
9. Context is compiled progressively from state and artifacts; raw history remains recoverable.
10. Quality-per-cost is measured, but cost optimization may not silently violate required quality.

## Logical architecture

```text
Clients
  -> API and realtime gateway
     -> Mission service and policy
        -> Agent runtime and scheduler
           -> Planner / model router / context compiler
           -> Tool gateway -> isolated workers
           -> Verifier and repair loop
        -> Event store / checkpoints / artifacts / memory
```

### Trusted control plane

Owns identity, sessions, missions, permissions, budgets, provider configuration, secret brokering,
worker leases, canonical events, approvals, and client fan-out. It does not load arbitrary plugins
in-process.

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

### Knowledge plane

Stores immutable mission events, versioned artifacts, checkpoints, working memory, project memory,
explicit user preferences, skill packages, provenance, and eval outcomes. Repository state and
current primary evidence override remembered facts.

### Experience layer

Begins with a responsive web client against the same protocol later used by iOS/iPadOS/macOS and
Android clients. Clients are observers/controllers, not the source of mission truth.

## Implemented mission runtime

`src/mission` and `src/events` implement the deterministic M2 control core: a closed mission state
machine, validated task DAG, deterministic dependency/priority scheduling, integer budgets, bounded
equivalent-failure circuit breaking, append-only event projection, optimistic aggregate versions,
idempotent event batches, integrity-checked checkpoints, and interruption/recovery replay.

The current event store is an in-memory contract adapter. Durable SQLite/PostgreSQL persistence and
multi-process leases are not claimed yet.

## Implemented provider boundary

`src/providers` implements normalized request, response, usage, tool-call, structured-output,
streaming, and typed-error contracts. OpenAI uses the Responses API; Anthropic uses the Messages API;
OpenRouter and NVIDIA use separately named adapters over a shared configurable chat-completions
protocol adapter.

Capabilities, routing characteristics, and price metadata come from provenance-bearing profiles.
Unknown profiles and unsupported features fail before credentials are resolved. Provider HTTP uses
fixed validated base URLs, rejects redirects, bounds bodies/events, denies obvious private-network
targets by default, and exposes retry hints without owning retry policy. This boundary is
contract-tested with injected transports; live end-to-end provider compatibility is not yet claimed.

## Implemented tool-control boundary

`src/tools` implements the M3 fail-closed tool gateway. A registry exposes compact tool summaries
independently from executable handlers and resolves full manifests only when needed. Tool manifests
carry stable versions, risk classes, operations, strict schemas, retry policy, provenance, and trust
class.

Inputs fail closed before policy or handler execution. Capability grants bind mission, task, tool,
operation, resource scope, call ceiling, and expiry. High-risk calls additionally require matching,
unexpired approval evidence. Side-effecting calls require idempotency keys and concurrent calls with
the same key serialize before the handler. Replays return the prior result while mismatched input for
the same key fails.

Built-in repository registrations expose `repo.search`, `repo.read`, `repo.patch`, and `repo.quality`
through injected adapters. Paths are restricted to workspace-relative forms and model-provided shell
strings are never accepted. These helpers are defense in depth and do not constitute an OS sandbox or
symlink-safe filesystem implementation by themselves.

## Implemented M4 coding vertical slice

`src/runtime/coding.ts` and `src/runtime/coding-contract.ts` connect the M1, M2, and M3 boundaries in a
verified end-to-end fixture workflow.

The bootstrap sequence is deliberately narrow:

1. a runtime-owned bootstrap scope discovers relevant files and registered quality-command IDs only
   through M3 repository tools;
2. generated/vendor paths are filtered and retrieved content is bounded;
3. an injected `ModelProvider` produces a strict-schema plan;
4. the plan is rejected unless its target file, optimistic SHA, task shape, and quality-command ID
   match the bounded discovery result;
5. only then is the canonical M2 mission/task graph created.

The canonical mission contains one model-proposed change task plus an Odin-owned quality task.
Runtime-owned definition-of-done markers record the selected changed file and quality-command ID in
replayable mission state. Model output is forbidden from supplying those reserved markers.

During execution:

- repository reads, patches, and quality runs pass through M3 grants, schemas, idempotency, timeouts,
  call ceilings, and audit records;
- provider token usage, tool calls, and attempts are debited into M2 mission budgets;
- the first required quality failure becomes bounded failure evidence and transitions to diagnosis;
- a strict-schema repair proposal may modify only the persisted target path and must use the current
  optimistic SHA;
- the same registered quality gate is rerun after the bounded repair;
- a repeated required failure reaches `FAILED`; a green gate is required before
  `CHECKPOINTING -> FINAL_AUDIT -> COMPLETED`.

M4 also proves restart-equivalent orchestration: after the first gate failure a checkpoint can be
created, fresh runtime/orchestrator objects can replay the same event-store contract, reconstruct the
target file and quality command from canonical mission state, and continue without reapplying the
initial patch.

This is contract-level evidence, not a production-runtime claim. CI uses a scripted provider plus
in-memory/injected workspace, quality-runner, event-store, and audit fixtures. It proves orchestration
semantics but not live-provider reliability, OS isolation, or durable process recovery.

## Implemented M5 verification authority

`src/verification` is a non-mutating authority between execution evidence and completion. The
verifier accepts bounded typed claims, evidence, and bindings. It requires canonical UTC timestamps,
allowlisted evidence kinds/producers/statuses, SHA-256 content metadata, matching mission/task scope,
fresh observations, successful status, and explicit coverage of every required evidence kind.
Duplicates, missing references, pre-change/future/stale observations, and contradictory results fail
closed. Findings and verdicts are deterministically sorted and hash-addressed.

The adversarial reviewer is a separate interface and pass. It checks evidence reuse across unrelated
task scopes, weak or self-authored provenance, stale/pre-change observations, and contradictory
status. It may `ACCEPT`, `BLOCK`, or issue a bounded `REPAIR_REQUIRED` request, but it has no tool,
repository, mission-state, network, or credential authority. Its output is validated for scope,
schema, verdict/finding consistency, bounds, and result hash; failure or malformed output blocks.

M4 requires this authority as an injected dependency. After the registered quality gate succeeds,
the orchestrator performs a fresh scoped repository read and compiles all persisted definitions of
done into M5 claims. Task verification and `CHECKPOINTING -> FINAL_AUDIT -> COMPLETED` occur only after
a consistent verifier `PASS`, reviewer `ACCEPT`, and aggregate `PASS`. Other outcomes leave the
mission terminally `BLOCKED` with a typed gate error for the controlling layer.

## Current module map

```text
src/
  mission/       mission aggregate, task DAG, state machine, budgets, checkpoints
  events/        append-only event contracts and in-memory contract adapter
  providers/     normalized model API, capabilities, adapters, errors
  tools/         contracts, discovery, policy, audit, repository execution boundary
  runtime/       M4 coding orchestrator, strict plan/repair, M5 evidence compilation
  persistence/   local SQLite adapter later; server PostgreSQL adapter later
  routing/       empirical model/effort selection later
  verification/ M5 typed evidence verifier and adversarial review authority
  context/       M6 priority budgets and context packages
  artifacts/     content-addressed artifact metadata later
  cli/           first user-facing entry point later
```

An interface exists only when it protects a real substitution, trust boundary, or test seam. Local
single-user mode and server mode use the same domain contracts but may use different persistence and
worker adapters.

## Next architecture milestone

M6 adds working/project memory, source-aware retrieval, structured session snapshots, context priority
budgets, and a deterministic context compiler. Repository and current source evidence must override
remembered facts; compaction may discard lower-priority history but never system invariants or the
current mission/task contract.

## Storage direction

Local mode will use SQLite with WAL, short transactions, explicit schema versions, optimistic mission
versions, and no external call inside a write transaction. Server/team mode will use PostgreSQL via
the same repository contracts. Events are durable facts; projections and context summaries can be
rebuilt. Large logs and outputs are artifacts referenced by hash rather than embedded in events.

## Deployment direction

The MVP remains a modular service plus isolated worker process, not a fleet of microservices. Split a
component only when isolation, independent scaling, or failure containment is demonstrated. Mobile
clients never host the canonical long-running runtime.
