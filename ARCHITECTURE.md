# Odin architecture

Status: M12-A/B local execution and provider-neutral sandbox lifecycle partially verified, 2026-09-03.

## Repository finding

Odin began as a greenfield repository. The product remains a strict TypeScript modular monolith:
boundaries are explicit because they protect trust, substitution, recovery, or testing, not because the
system has been prematurely split into microservices.

## System invariants

1. Durable mission state, not conversation history or client state, is canonical.
2. The model proposes; deterministic runtime and policy decide what executes.
3. Important work cannot become complete without mapped verification evidence.
4. Execution is scoped, interruptible, budgeted, and deny-by-default.
5. Provider, tool, skill, memory, persistence, worker, client, routing, and sandbox protocols are versioned boundaries.
6. External content, repository content under analysis, tool output, model output, worker output, and
   client input are untrusted.
7. Credentials remain in the trusted control plane and are never placed in model or client payloads.
8. Consequential state changes and side effects are auditable without storing hidden reasoning.
9. Context is compiled progressively from state and artifacts; raw history remains recoverable.
10. Quality-per-cost may be optimized only after the required quality floor is preserved.
11. Specialists propose bounded work; the runtime retains scheduling, ownership, acceptance, and settlement.
12. Local durability is not distributed correctness: SQLite recovery never implies exactly-once external effects.
13. Clients are observers/controllers. They cannot append arbitrary events, settle jobs, call tools or models directly, or bypass M5 completion evidence.
14. Skill instructions are reusable procedure, never authority. Learned/community skills require exact provenance, independent verification, and trusted promotion before normal runtime loading.
15. Adaptive reasoning is runtime policy, not model authority: route, branch, critique, repair, escalation, cost, call, concurrency, and token ceilings remain runtime-owned and independently verifiable.
16. Sandbox/provider selection is runtime policy: a routed model identity may select a configured sandbox backend, but models cannot choose a stronger sandbox scope or receive its raw credentials.

## Logical architecture

```text
Web / future native clients
  -> versioned client protocol / future API + realtime transport
     -> mission/session policy and controller gateway
        -> deterministic mission runtime and scheduler
           -> planner / empirical model router / context compiler
              -> bounded branch / critique / repair / escalation policy
              -> exact model/profile sandbox binding
           -> M3 tool gateway -> M12 execution/sandbox boundary -> workers
           -> verifier and repair loop
        -> canonical events / checkpoints / durable jobs / artifacts / memory / skills / eval metadata
```

### Trusted control plane

Owns identity, sessions, missions, permissions, budgets, provider configuration, secret brokering,
worker leases, canonical events, approvals, persistence, routing policy, sandbox backend configuration,
and future client fan-out. It does not load arbitrary plugins in-process and does not trust
client/model-supplied capability or credential objects.

### Cognitive runtime

Owns task classification, planning effort, dependency-aware task graphs, context compilation,
provider-independent model requests, empirical route selection, bounded reasoning strategy,
verification strategy, evidence collection, targeted repair, and final audit. It cannot bypass policy,
raise its own budget/quality evidence, or mark itself complete without required evidence.

### Execution plane

Runs filesystem, terminal, browser, repository, and programmatic-workflow tools behind policy and
isolation boundaries. Host execution and unrestricted network access are never defaults. M3 remains
the tool/capability authority. M12 adds canonical workspace enforcement, a bounded trusted-command
host-process runner, fail-closed outbound destination policy, and a provider-neutral remote-sandbox
lifecycle/binding boundary. The host-process runner is **not** kernel/container isolation, and no
specific hosted sandbox provider is claimed until a real adapter is authorized and exercised.

### Knowledge and persistence plane

Stores canonical mission events, validated checkpoints, durable job state, lifecycle cursors,
versioned artifacts, working/project/user memory, skill packages, provenance, and eval outcomes.
Repository state and current primary evidence override remembered facts.

M8 implements the first durable local state adapter with Node 24 `node:sqlite`. Canonical mission
events remain source of truth. Checkpoints are derived and must reproduce from canonical events.
Worker jobs use at-least-once semantics with fenced settlement. This is not a hosted queue or
cross-host correctness claim.

### Experience layer

M9 introduces one strict client protocol for the responsive reference web shell and future native
clients on iOS, iPadOS, macOS, and Android. A client receives a bounded derived mission projection plus
paged durable lifecycle activity. It may request only explicitly granted controls. Device suspension
does not suspend the canonical long-running mission; a future transport reconnects from durable state.

M8 lifecycle cursors are globally increasing while client reads are mission-scoped. Therefore cursor
values observed for one mission can have numeric gaps. M9 continuity is based on exact `afterCursor`
chaining, monotonic delivered events, scope, and event hashes rather than requiring `cursor + 1`.

## Implemented milestones

### M1 — Provider boundary

`src/providers` normalizes requests, responses, streaming, usage, tool calls, structured output, and
typed errors across OpenAI, Anthropic, OpenRouter, NVIDIA, and explicit compatible endpoints. Unknown
capabilities fail before credentials resolve. M12 extends the credential resolver with exact
provider/model context. Tests use injected transports; live-provider end-to-end compatibility is not yet claimed.

### M2 — Mission runtime

`src/mission` and `src/events` implement closed mission states, validated task DAGs, deterministic
scheduling, integer budgets, bounded equivalent-failure circuits, append-only events, optimistic
aggregate versions, idempotent batches, checkpoints, and replay.

### M3 — Tool-control boundary

`src/tools` provides progressive tool discovery, strict schemas, capability grants, approval evidence,
idempotency, timeout/retry ownership, secret-safe audit records, and scoped repository search/read/
patch/quality operations through injected adapters. It accepts no model-provided shell string.

### M4 — Coding vertical slice

`src/runtime` connects M1/M2/M3 through a fixture-backed coding workflow: bounded repository discovery,
strict plan validation, scoped patching, a deliberate quality failure, diagnosis/repair, green rerun,
checkpoint/replay, and evidence reporting. This is orchestration proof, not a production sandbox.

### M5 — Verification authority

`src/verification` validates typed claims, evidence, bindings, scope, timestamps, hashes, freshness,
producer class, and coverage. A separate adversarial reviewer returns `ACCEPT`, `BLOCK`, or bounded
`REPAIR_REQUIRED`. Missing, stale, foreign, failed, contradictory, malformed, duplicated, weak, or
self-authored evidence cannot silently complete work.

### M6 — Memory and context

`src/memory` defines scoped/versioned working, episodic, semantic, project, and explicit user-preference
memory contracts. `src/context` compiles P0–P6 context with mandatory P0–P2, current-source precedence,
deterministic budget estimates, sensitive-cache exclusion, and integrity-checked session snapshots.
The memory adapter remains in-memory.

### M7 — Specialist coordination

`src/coordination` adds bounded specialist discovery, dependency-ready assignment, logical repository/
resource/state ownership, concurrency ceilings, expiring in-process leases, cancellation, strict
proposal validation, runtime evidence attestation, and deterministic reconciliation. Specialists remain
untrusted proposal producers.

### M8 — Durable missions and worker recovery

`src/durable` persists M2 events, validated checkpoints, durable jobs, and lifecycle events in local
SQLite. It provides deterministic claims, bounded attempts, expiring leases, fencing generations,
hashed opaque tokens, heartbeat/timeout/cancellation settlement, corruption checks, reopen recovery,
and mission-scoped cursor reads. Recovery tests include stale-generation rejection and a 32-job
interrupted fixture.

### M9 — Client protocol and responsive shell

`src/client` adds strict protocol codecs, bounded projections, exact mission/session capability policy,
controller-only pause/resume/cancel, optimistic expected versions, durable idempotency, state bootstrap,
paged reconnect, and a deterministic reducer. Foreign scope, changed hashes, unsupported versions,
stale projections, and continuity violations fail closed or require bootstrap resync.

`web/` is a framework-free reference fixture showing mission state, tasks, budgets, durable worker
activity, evidence, reconnect state, pause/resume, and deliberate cancel confirmation. It uses no live
transport and stores no mission state in browser persistent storage.

### M10 — Progressive skill lifecycle and synthesis

`src/skills` adds immutable hash-addressed skill packages, compact discovery, separately bounded full
instruction loading, provenance/trust classes, candidate/verified/active/revoked lifecycle,
independent verification, trusted promotion, deterministic supersession/rollback, and concise
lifecycle audit events. Learned/community content never becomes normal runtime instruction merely
because a model or worker claims success.

`SkillSynthesisService` can convert an attested solved task into a learned `CANDIDATE` with exact
source mission/task provenance and idempotency. It does not execute generated code, install public
packages, register M3 tools, mint capabilities, expose credentials, or bypass M5/M7 authorities.

### M11 — Adaptive reasoning, routing, and efficiency

`src/routing` adds hash-addressed empirical evaluation records, exact provider/model/profile/effort
binding, capability-first filtering, risk/uncertainty-adjusted quality floors, deterministic
quality-before-cost route selection, stronger eligible escalation paths, bounded cache metadata, and an
offline small/fast-versus-stronger evaluation harness.

`AdaptiveReasoningController` limits continuation to `ACCEPT`, `CRITIQUE`, `REPAIR`, `ESCALATE`, or
`BLOCK`. Only independent non-contradictory PASS evidence can accept. Branch, critique, repair,
model-call, parallel-call, cost, and estimated-token ceilings are runtime-owned.

### M12-A/B — Local execution hardening and sandbox backend boundary

`src/sandbox` canonicalizes the trusted workspace root, denies lexical/canonical escape, bounds trusted
subprocess execution, and evaluates outbound destinations before a future transport is allowed to use
them. Sandbox backends are selected by exact provider/model/profile identity. Runtime-owned credential
references are resolved only after binding checks, and M11 route decisions feed the selected exact
model identity into sandbox allocation.

Remote sandbox creation is idempotent per mission/task/backend/model/profile allocation identity.
Identical sequential or concurrent replay shares one create operation; conflicting replay fails closed.
Remote backends must implement cleanup, release is idempotent, and released sessions cannot be reused.
Provider expiry metadata is validated when present and omitted when absent. These contracts are
provider-neutral and have no live sandbox-provider proof yet.

Normal PR run `33794095989` verified this tranche with 237/237 tests and aggregate coverage 89.43%
lines / 76.28% branches / 95.37% functions.

## Current module map

```text
src/
  mission/       mission aggregate, task DAG, state machine, budgets, checkpoints
  events/        append-only event contracts and in-memory contract adapter
  providers/     normalized model API, capability profiles, adapters, transport errors
  tools/         tool discovery, policy, schemas, audit, repository execution authority
  runtime/       coding orchestrator, strict plan/repair, verification integration
  verification/  typed evidence verifier and adversarial review authority
  memory/        asynchronous scoped memory contracts and in-memory adapter
  context/       retrieval facade, P0-P6 compiler/cache, session snapshots
  coordination/  specialist registry, logical ownership, bounded execution, reconciliation
  durable/       SQLite mission events/checkpoints/jobs, lifecycle cursors, runner recovery
  client/        M9 protocol codecs, controller gateway, reconnect reducer
  skills/        M10 progressive skill registry, synthesis, verification/promotion history
  routing/       M11 empirical model/effort selection, cache, eval harness, bounded reasoning
  sandbox/       M12 canonical workspace, bounded process/network policy, backend lifecycle/routing
  artifacts/     content-addressed artifact byte/storage layer later
  cli/           user-facing entry point later
web/             M9 responsive static reference client
```

## Next architecture milestone

M12-C completes the no-cost production-hardening work around the verified M12-A/B execution boundary:
structured secret-safe observability, deterministic load/recovery evidence, backup/recovery contracts,
release manifests, and fail-closed release gates.

Live-provider/sandbox smoke matrices, production deployment, public service/auth transport, and any
paid infrastructure require separate explicit authorization and remain unproven until actually
exercised.

## Storage and deployment direction

Local mode uses verified SQLite durability for mission events, checkpoints, jobs, and lifecycle
cursors. Server/team mode may later add PostgreSQL or a hosted job transport behind the same domain
contracts. Large outputs should become content-addressed artifacts rather than embedded event/job data.

The MVP remains a modular service plus isolated worker boundary, not a fleet of speculative
microservices. Split a component only when isolation, independent scaling, or failure containment is
demonstrated. Mobile clients never host the canonical long-running runtime.
