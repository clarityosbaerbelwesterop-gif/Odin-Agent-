# Odin architecture

Status: M0–M13 are merged and verified; M14 skill-intake implementation is verified in normal PR CI and this synchronized head is awaiting its final exact-head CI before merge. M12 remains partially verified for hosted-sandbox/public-production proof, 2026-09-04.

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
17. Learned experience is lower-authority data: only independently verified, hash-bound repeated outcomes may become established M13 learning, and learned memory never mints execution, completion, skill-promotion, budget, routing, credential, or user-preference authority.

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
provider/model context. Injected-transport tests remain the broad compatibility base; M12-D separately proves
one bounded real NVIDIA/Kimi K3 end-to-end provider path, not universal live-provider compatibility.

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

### M12-C — Observability, recovery evidence, and release proof

`src/observability` adds bounded structured runtime events with deterministic identity and fail-closed
secret-like metadata rejection. `src/release` adds hash-bound release evidence, monotonic local /
integration / live claim policies, backup/restore proof, deterministic recovery proof, and release gates
that reject missing, stale, foreign, failed, tampered, or weaker-than-required evidence.

Sandbox cleanup was additionally hardened so concurrent identical releases collapse to one remote
`destroy` operation while conflicting release reasons fail closed. The local end-to-end release fixture
proves that repository verify + recovery + restore evidence can unlock only a local claim and cannot be
relabelled into integration/live proof. Normal PR run `33796268313` passed 258/258 tests with 89.29%
line / 76.24% branch / 95.64% function coverage.

### M12-D — Bounded live-provider evidence

A dedicated live runner reuses the existing M4 coding fixture but replaces the scripted model boundary
with the real `NvidiaProvider` and `moonshotai/kimi-k3`. Repository secret resolution remains in the
control plane and is restricted to the exact provider/model identity. The live workflow first reruns
all deterministic gates, caps the model path at two calls, persists only sanitized evidence, and is
manual-only after the evidence run.

Live run `33837291528` completed the mission first pass with one provider call, 632 input / 222 output
tokens, 22.4 s latency, seven Odin tool calls, deterministic `verify` exit 0, and M5 PASS for a 100/100
smoke score. This proves one live provider integration, not a hosted sandbox, broad benchmark, model
superiority, or AGI.

### M13 — Evidence-backed post-task learning

`src/learning` converts repeated independently verified task outcomes into scoped learning records with exact semantic-key and lesson-content hashes. Three distinct mission/task supports are required for establishment; competing content under the same user/project/key is conflicted and cannot become a nudge or memory entry. Exact replay is resolved before requesting fresh evidence, while a second replay check after the asynchronous authority call preserves race safety.

Established, non-conflicted learning may enter M6 only as `verified_learning` semantic memory. Broad semantic retrieval deliberately excludes it unless the caller explicitly asks for the `m13-learning` tag. M13 maintenance may cool stale records and archive under-supported stale conflicts, allowing a sufficiently supported surviving lesson to re-establish without deleting already committed M6 memory.

The shared `src/security/secret-text.ts` primitive is used by both observability and learning intake to reject obvious credential patterns. M13 cannot register tools, grant capabilities, promote skills, infer durable user preferences, change routing quality floors, increase budgets, or mark a task complete. Run `33852005166` verified 272/272 tests after the replay/maintenance hardening.

### M14 — Skill intake firewall

`src/skill-intake` converts one externally resolved skill snapshot into immutable bounded evidence without executing third-party code. The trusted resolver must bind repository, requested ref, selected path, and an exact 40-hex commit. File count, per-file bytes, total bytes, path depth, and retained findings are bounded; binaries, symlinks, truncation, incomplete inventory, unknown license state, and malformed manifests remain explicit limitations rather than being interpreted as clean coverage.

Static findings cover prompt override, credential collection/exfiltration, download-and-execute patterns, destructive writes, privilege escalation, self-promotion, policy/memory poisoning, dependency installation, explicit shell/subprocess use, MCP configuration, hooks/workflows including nested `.github/workflows` surfaces, and executable content. Findings retain stable hashes/fingerprints instead of matched raw snippets.

Only `COMPLETE + ACCEPT` may become an M10 `community` candidate. M14 forces `requiredTools=[]` and cannot activate the skill, register M3 handlers, mint grants, expose credentials, change budgets/routing, or create M5 completion evidence. M10 independent verification/trusted promotion remains a separate authority boundary. Normal PR run `33858888408` passed 290/290 tests, Biome, strict TypeScript, and the secret-free Kimi dry smoke; aggregate coverage was 89.47% lines / 76.70% branches / 95.84% functions.

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
  observability/ M12-C secret-safe bounded runtime events
  release/       M12-C backup/recovery proof, release evidence/manifests, fail-closed gates
  learning/      M13 evidence-backed repeated learning, conflict curation, bounded nudges
  skill-intake/  M14 immutable community-skill intake, bounded risk/completeness quarantine
  security/      shared secret-text and future cross-cutting security primitives
  artifacts/     content-addressed artifact byte/storage layer later
  cli/           user-facing entry point later
web/             M9 responsive static reference client
```

## Next architecture milestone

The remaining M12 path is now hosted-sandbox and production evidence escalation. One real Kimi K3
provider path is verified, but hosted sandbox cleanup/isolation, broader live-model comparison, public
service/auth/realtime transport, deployment, and production recovery remain separate proof.

Local CI may never manufacture `integration` or `live` evidence. Any paid resource, deployment, or
production/public traffic remains separately approval-gated. With M14 implementation verified, the next no-cost capability milestone after merge is M15: evaluate and deduplicate community procedures against Odin's canonical runtime on held-out fixtures, measure output lift/safety/context cost, and promote only measured winners through M10. M15 may propose progressively loaded capability packs but cannot turn external instructions into authority or self-promote them.

## Storage and deployment direction

Local mode uses verified SQLite durability for mission events, checkpoints, jobs, and lifecycle
cursors. Server/team mode may later add PostgreSQL or a hosted job transport behind the same domain
contracts. Large outputs should become content-addressed artifacts rather than embedded event/job data.

The MVP remains a modular service plus isolated worker boundary, not a fleet of speculative
microservices. Split a component only when isolation, independent scaling, or failure containment is
demonstrated. Mobile clients never host the canonical long-running runtime.
