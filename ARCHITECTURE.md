# Odin architecture

Status: M3 tool-runtime checkpoint candidate, 2026-09-02.

## Repository finding

The repository began with one README line and no implementation, tests, CI, security policy, or
prior architecture. Odin is therefore a greenfield system. The design below is intentionally a
modular monolith for the first vertical slice: boundaries are explicit, but deployment is not split
into speculative microservices.

## System invariants

1. Durable mission state, not conversation history, is canonical.
2. The model proposes; deterministic runtime and policy decide what executes.
3. Important work cannot become complete without mapped verification evidence.
4. Execution is isolated, scoped, interruptible, budgeted, and deny-by-default.
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
and final audit. It cannot bypass policy or mark itself complete without verifier evidence.

### Execution plane

Runs filesystem, terminal, browser, repository, and programmatic-workflow tools. Workers receive
short-lived capabilities scoped to task, resource, operation count, network destinations, and expiry.
Host execution and unrestricted network access are never defaults.

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
Android clients. Clients are observers/controllers, not the source of mission truth. Realtime streams
support multiple viewers and reconnect from durable event offsets.

## Mission state machine

The core state set is:

```text
CREATED -> UNDERSTANDING -> RETRIEVING -> PLANNING -> RISK_CHECK
        -> EXECUTING -> OBSERVING -> VERIFYING
        -> CHECKPOINTING -> FINAL_AUDIT -> COMPLETED

VERIFYING -> DIAGNOSING -> REPAIRING -> VERIFYING
Any active state -> PAUSING -> PAUSED -> RESUMING -> prior safe state
Any active state -> CANCELLING -> CANCELLED
Any active state -> BLOCKED or FAILED when a typed terminal condition applies
```

Transitions are a closed table with preconditions. Events are appended only after optimistic version
checks. A transition request and its idempotency key produce at most one accepted transition.

## Initial module map

The first vertical slice stays within one TypeScript workspace:

```text
src/
  mission/       mission aggregate, task DAG, state machine, focus
  events/        event contracts and durable append interface
  persistence/   local SQLite adapter later; in-memory contract test adapter first
  providers/     normalized model API, capabilities, adapters, errors
  routing/       effort and model selection
  tools/         contracts, discovery, policy, audit, execution boundary
  verification/ gates, evidence, failure classification, repair decisions
  context/       priority budgets and context packages
  artifacts/     content-addressed artifact metadata
  runtime/       orchestration and cancellation
  cli/           first user-facing entry point
```

An interface exists only when it protects a real substitution, trust boundary, or test seam. Local
single-user mode and server mode use the same domain contracts but may use different persistence and
worker adapters.

## Implemented provider boundary

`src/providers` currently implements normalized request, response, usage, tool-call, structured
output, streaming, and typed-error contracts. OpenAI uses the Responses API; Anthropic uses the
Messages API; OpenRouter and NVIDIA use separately named adapters over a shared configurable
chat-completions protocol adapter.

Capabilities, routing characteristics, and price metadata come from provenance-bearing external
profiles. Unknown profiles and unsupported features fail before credentials are resolved. Provider
HTTP uses fixed validated base URLs, rejects redirects, bounds bodies/events, denies obvious private
network targets by default, and exposes retry hints without owning retry policy. This boundary is
contract-tested with injected transports only; live API compatibility is not yet verified.

## Implemented mission runtime

`src/mission` and `src/events` implement the deterministic M2 control core: a closed mission state
machine, validated task DAG, deterministic dependency/priority scheduling, integer budgets, bounded
equivalent-failure circuit breaking, append-only event projection, optimistic aggregate versions,
idempotent event batches, integrity-checked checkpoints, and interruption/recovery replay.

The current event store is an in-memory contract adapter. Durable SQLite/PostgreSQL persistence and
multi-process leases are not claimed yet.

## Implemented tool-control boundary

`src/tools` implements the M3 fail-closed tool gateway contracts. A registry exposes compact tool
summaries independently from executable handlers and resolves full manifests only when needed. Tool
manifests carry stable versions, risk classes, operations, strict schemas, retry policy, provenance,
and trust class.

Inputs fail closed before policy or handler execution. Capability grants bind mission, task, tool,
operation, resource scope, call ceiling, and expiry. High-risk calls additionally require matching,
unexpired approval evidence. Side-effecting calls require idempotency keys and concurrent calls with
the same key serialize before the handler. Replays return the prior result while mismatched input for
the same key fails.

Retries and timeouts are runtime-owned. In M3, side-effecting handlers are deliberately single-attempt
until worker-level idempotency exists; retryable read/search handlers may retry only within configured
attempt and capability-call ceilings. Audit records persist hashes and result/policy metadata instead
of raw tool input or resource values.

Built-in repository registrations expose `repo.search`, `repo.read`, `repo.patch`, and `repo.quality`
through injected adapters. Paths are restricted to workspace-relative forms and model-provided shell
strings are never accepted. These helpers are defense in depth and do not constitute an OS sandbox or
symlink-safe filesystem implementation by themselves.

## First vertical slice

Input: a local disposable workspace plus a narrowly specified coding task.

Required outcome:

1. create and persist a mission and task graph;
2. discover repository metadata and applicable quality commands;
3. compile a bounded context package;
4. obtain a schema-validated plan through the provider boundary;
5. request scoped read/search/patch/test tools through policy;
6. apply a minimal change in an isolated workspace;
7. run required quality gates and capture artifacts;
8. diagnose and repair a failing gate within retry and budget limits;
9. checkpoint and resume from durable state;
10. emit an evidence-mapped final report with usage.

It is not complete until an end-to-end fixture test proves this behavior, including one repair and
one interrupted/resumed run. Live-provider success is a separate, opt-in smoke test.

## Storage direction

Local mode will use SQLite with WAL, short transactions, explicit schema versions, optimistic mission
versions, and no external call inside a write transaction. Server/team mode will use PostgreSQL via
the same repository contracts. Events are durable facts; projections and context summaries can be
rebuilt. Large logs and outputs are artifacts referenced by hash rather than embedded in events.

## Deployment direction

The MVP is a modular service plus isolated worker process, not a fleet of microservices. Split a
component only when isolation, independent scaling, or failure containment is demonstrated. Mobile
clients never host the canonical long-running runtime.
