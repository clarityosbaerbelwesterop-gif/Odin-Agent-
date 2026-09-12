# Odin architecture

## PRODUCT M1 product boundary (2026-09-12)

The Personal Agentic Workspace is a product layer over Odin's existing authorities. A persisted chat
conversation is exposed as a Project compatibility projection; its turns are Runs, its M2 tasks are the
visible plan, and its durable chat events feed Activity. The Companion is a reversible mapping of M2
mission states. These product views cannot write mission state or accept completion.

The global shell presents Home, Projects, Knowledge, Automations, Skills and Activity. A Project
presents Overview, Workspace, Knowledge, Tasks, Runs and Activity. Existing auth/RLS, provider,
credential, Stripe, GitHub, tool, verification, memory and skill boundaries remain the only
authorities. The full decisions are recorded in
`docs/PRODUCT_M1_MIGRATION_MATRIX.md` and `docs/PRODUCT_M1_INTEGRATION_AUDIT.md`.

## S–U product completion contract (2026-09-09)

The product control plane has exactly four ordered plans: Free, Pro, Developer and Ultra. Runtime
authorization derives an effective plan from authoritative Stripe state (`active` or `trialing` only),
then enforces both the selected model floor and mode floor server-side. Coding requires Developer plus
an authenticated, connected and selected GitHub repository; Ultra requires Ultra. The official hosted
GitHub MCP endpoint is pinned read-only and its audited read operations are normalized into M3 tool
registrations; repository mutations remain exclusively in the existing isolated GitHub workspace.

## P–R product control plane (2026-09-09)

The hosted product reuses Neon Auth and the transaction-local `odin_runtime` identity boundary. Product
accounts, encrypted BYOK credentials, GitHub connections, one-time OAuth state and Stripe event records
are tenant-scoped persistence, not new mission or permission authorities. GitHub coding implements the
existing repository workspace contract and writes through a newly created `odin/*` branch; GitHub checks
are observed as quality evidence and absent checks remain incomplete. Stripe webhooks, never browser
redirects, update entitlements with event replay and ordering guards. M3, M5 and M11 remain authoritative.

Status: M0–M28 and intelligence A–C are merged and repository-verified on `main`. Intelligence D–F
is package-verified on PR #36 and awaits only the final governance-head CI plus merge. M12/M26 remain
**PARTIALLY_VERIFIED** for real hosted-sandbox/public-production proof; no repository-local contract,
synthetic fixture, benchmark report, amplification candidate, or weakness analysis may be relabeled as
live infrastructure or live model-performance evidence.

## Architectural thesis

Odin is a strict TypeScript modular monolith with explicit trust boundaries. A boundary exists because
it protects authority, substitution, recovery, verification, or testability—not because the system is
prematurely split into services.

The core product is an agent runtime, not a chat transcript. Durable mission state, deterministic
policy, scoped execution, evidence-backed completion, progressive context, and resumable workers remain
canonical even when models, skills, tools, clients, or providers change.

## System invariants

1. Durable mission state, not conversation history or client state, is canonical.
2. Models propose; deterministic runtime and policy decide what executes.
3. Important work cannot become complete without mapped M5 verification evidence.
4. Execution is scoped, interruptible, budgeted, idempotent where required, and deny-by-default.
5. Provider, tool, skill, memory, persistence, worker, client, routing, sandbox, and evaluation
   protocols are versioned boundaries.
6. External content, repository content under analysis, tool output, model output, worker output, skill
   content, memory, and client input are untrusted data until validated.
7. Credentials stay in the trusted control plane and never become model/client/normal-worker payloads.
8. Consequential state changes and external side effects are auditable without storing hidden reasoning.
9. Context is compiled progressively from current state and artifacts; raw history remains recoverable.
10. Quality-per-cost optimization occurs only after the required quality floor is preserved.
11. Specialists propose bounded work; runtime retains scheduling, ownership, acceptance, and settlement.
12. Local durability is not distributed correctness; SQLite recovery never implies exactly-once external
    effects or multi-host fencing.
13. Clients are observers/controllers and cannot append arbitrary events, settle jobs, execute tools,
    resolve credentials, or bypass verification.
14. Skills are reusable procedure, never authority. M10 owns lifecycle and M15 owns measured community
    pack evidence.
15. Adaptive reasoning is runtime policy: route, branch, critique, repair, escalation, cost, call,
    concurrency, and token ceilings are runtime-owned.
16. Sandbox/provider selection is runtime policy. A routed model cannot choose stronger isolation,
    filesystem/network scope, or credentials.
17. Learned and remembered experience is lower-authority data. Current repository/runtime/task evidence
    wins conflicts.
18. M23 Skill OS selects only already-eligible exact capability-pack revisions and cannot change M10/M15
    lifecycle or evidence.
19. M24 advanced memory cannot convert remembered conclusions or model summaries into current-source
    authority.
20. M25 tool descriptors are catalog metadata only; all execution authority remains in M3.
21. Intelligence evaluation and weakness analysis are evidence/analytics only: Phase A profile envelopes,
    Benchmark 2.0 reports, and Phase C heatmaps cannot mint M3/M5/M10/M11/M12/release authority.
22. D–F amplification policy objects remain bounded runtime/evaluation data. Hash validity never substitutes
    for semantic validation, and D/E/F cannot create tools, credentials, routing quality, promotion,
    completion, approval, sandbox, or release authority.

## Logical architecture

```text
Web / future native clients
  -> versioned client protocol / future API + realtime transport
     -> mission/session policy + controller gateway
        -> deterministic mission runtime and scheduler
           -> planner / empirical model router / context compiler
              -> bounded branch / critique / repair / escalation policy
              -> Skill OS selection over verified capability packs
              -> exact model/profile sandbox binding
           -> M3 tool gateway
              -> M25 typed ecosystem catalog
              -> M12/M26 execution + sandbox boundary
              -> workers / external adapters
           -> M5 verifier + adversarial review / repair loop
        -> canonical events / checkpoints / durable jobs / artifacts
        -> scoped memory + learning + skill packages + evaluation evidence
        -> A–C evaluation profile / Benchmark 2.0 / weakness analytics
```

## Trust and execution planes

### Trusted control plane

Owns identity, sessions, missions, permissions, budgets, provider configuration, secret brokering,
worker leases, canonical events, approvals, persistence, routing policy, sandbox backend configuration,
Skill OS selection policy, and future client fan-out. It does not load arbitrary community code
in-process and does not trust client/model/skill/tool-shaped authority objects.

### Cognitive runtime

Owns task classification, planning effort, dependency-aware task graphs, context compilation,
provider-independent model requests, empirical route selection, bounded reasoning, capability-pack
selection, verification strategy, evidence collection, targeted repair, and final reporting. It cannot
raise its own budget/quality evidence or complete a task without the required independent evidence.

### Execution plane

Runs repository/filesystem/terminal/browser/database/cloud/document/data/API/research operations only
behind policy and isolation boundaries. M3 owns tool registration, grants, approvals, schema validation,
idempotency, timeout/retry, cancellation, handler dispatch, and audit. M25 adds uniform discovery but no
new execution authority. M12 supplies canonical workspace, process/network policy, and a provider-neutral
remote-sandbox lifecycle. M26 defines strong-isolation contracts, while real container/VM proof remains a
separate external release gate.

### Knowledge and persistence plane

Stores canonical mission events, validated checkpoints, durable job state, lifecycle cursors,
content-addressed artifacts, scoped memory, skill packages, provenance, and evaluation outcomes.
Repository state and current primary evidence override remembered facts. M8 provides local SQLite
restart durability; M24 adds bounded advanced retrieval/maintenance over M6 without changing authority.
A–C evaluation profiles, benchmark reports, and weakness heatmaps live here as lower-authority evidence,
not as runtime permission or completion records.

### Experience/client plane

M9 defines strict bounded client projections and controller-only mission controls. Clients reconnect from
M8 lifecycle cursors and never become canonical mission state. M28 extends this into bounded mobile/native
experience contracts while keeping long-running compute server-side.

## Implemented capability map

### M1 — Provider boundary

`src/providers` normalizes requests, responses, streaming, usage, tool calls, structured output, and
typed failures across OpenAI, Anthropic, OpenRouter, NVIDIA, and explicit compatible endpoints.
Provider-specific payloads stop at adapters and credentials resolve only after trusted binding checks.

### M2 — Mission runtime

`src/mission` and `src/events` implement the closed mission state machine, task DAG, deterministic
scheduling, budgets, bounded retries, pause/resume/cancel, append-only events, checkpoints, optimistic
versions, and replay.

### M3 — Tool-control authority

`src/tools` provides progressive discovery, strict schemas, scoped capability grants, approval evidence,
idempotency, timeout/retry/cancellation, secret-safe audit, and scoped repository operations. Models
cannot supply arbitrary shell strings or mint tool authority.

### M4 — Coding vertical slice

`src/runtime` composes provider planning, scoped repository discovery, strict plan validation, mutation,
quality gates, targeted repair, checkpoint/replay, and evidence reporting. Later M16 surgical coding and
M19 multi-file coordination harden the same authority boundaries rather than creating parallel ones.

### M5 — Verification authority

`src/verification` validates bounded claims/evidence/bindings, producer class, freshness, scope, hashes,
coverage, and contradictions. Independent adversarial review returns ACCEPT, BLOCK, or bounded
REPAIR_REQUIRED. Missing or weak evidence cannot silently complete work.

### M6 / M18 / M24 — Memory and context

`src/memory` provides scoped/versioned working, episodic, semantic, project, and explicit user-preference
records with optimistic versions, expiry, tombstones, sensitivity, and provenance. `src/context` compiles
P0–P6 context with mandatory P0–P2 authority, current-source precedence, bounded token estimates,
sensitive-cache exclusion, integrity snapshots, and M18 delta/semantic reuse.

M24 adds exact-scope advanced episodic/project retrieval, current-source comparison, stale marking,
conflict surfacing, bounded retention planning, tombstone delegation, and runtime-issued lower-authority
compression. Future timestamps, secret-like material, sensitivity downgrade, saturated-retention claims,
and tampered/replayed proposals fail closed.

### M7 — Specialist coordination

`src/coordination` adds bounded specialist discovery, dependency-ready assignment, logical ownership,
concurrency ceilings, expiring leases, cancellation, strict structured proposals, runtime evidence
attestation, and deterministic reconciliation. Workers remain untrusted proposal producers.

### M8 / M20 — Durable missions and long-running recovery

`src/durable` persists canonical M2 events, validated checkpoints, jobs, and lifecycle events in local
SQLite with integrity checks, bounded attempts, expiring fenced leases, opaque-token hashes,
heartbeat/settlement, cancellation, and crash/reopen recovery.

`src/autonomy` adds runtime-owned 6 h / 12 h / 24 h logical synthetic-clock soak profiles with
hash-chained observations, checkpoint/restart binding, generation fencing, cancellation terminality,
budget ceilings, and anti-loop validation. These prove logical recovery properties, not hosted uptime.

### M9 — Client protocol

`src/client` defines strict versioned codecs, bounded projections, mission/session capability policy,
controller-only pause/resume/cancel, expected versions, durable idempotency, bootstrap/reconnect, and a
deterministic reducer. `web/` is a static responsive reference client, not a public hosted service.

### M10 / M14 / M15 / M23 — Skill lifecycle and Skill OS

`src/skills` owns immutable hash-addressed packages, discovery, bounded instruction loading,
verification, activation, supersession, revocation, rollback, and candidate-only solved-task synthesis.

`src/skill-intake` treats external skill/plugin repositories as untrusted snapshots. It binds immutable
source identity, scans bounded content without execution, emits stable risk/completeness evidence, and
allows only COMPLETE+ACCEPT material to become an M10 community candidate with no M3 authority.

`src/capability-packs` measures distilled procedure candidates and creates progressive packs only when
exact M10 lifecycle and integrity-valid M15 evidence agree. Offline replay is proposal-only.

`src/skill-os` is the M23 runtime consumer of those already-verified packs. It performs compact discovery,
deterministic domain/task-class selection, exact pack/member/hash/freshness binding, progressive loading,
and explicit pin/history rollback. M23 cannot activate/promote a skill, register a tool, change memory,
or mint evidence.

### M11 / M21 — Adaptive multi-model routing

`src/routing` binds empirical quality/cost/latency evidence to exact provider/model/profile/reasoning/task
identity and chooses only routes that meet capability and effective quality floors. Bounded critique,
repair, branch search, and escalation remain runtime-owned.

M21 adds recent typed negative failure evidence for exact route exclusion. It may remove only the exact
recently failing route and cannot create positive quality, lower floors, add capability, or increase
budget.

### M12 — Local sandbox/release hardening

`src/sandbox` canonicalizes workspace roots, denies traversal/symlink escape, bounds trusted subprocess
execution, starts child environments deny-by-default, enforces timeout/output/concurrency ceilings,
validates outbound destinations, and binds sandbox lifecycle to exact provider/model/profile identity.
Remote lifecycle contracts are idempotent and cleanup-aware.

`src/observability` provides bounded secret-safe runtime events. `src/release` provides integrity-bound
local/integration/live evidence levels, recovery/backup proof, manifests, and fail-closed release gates.
One bounded live NVIDIA Kimi K3 provider path is verified, but no hosted sandbox/container/VM or public
service is currently proven.

### M13 — Evidence-backed learning

`src/learning` promotes repeated independently verified outcomes into lower-authority project learning
only after exact scope/hash/evidence checks and support thresholds. Conflicts block promotion. Learning
cannot create tools, credentials, budgets, route quality, durable user preferences, skill activation, or
completion evidence.

### M16 / M17 / M19 — Coding reliability

M16 uses runtime-bound exact `oldText`/`newText` surgical edits instead of model-owned full-file identity.
M17 deterministically classifies failures and chooses bounded retry/repair/alternate-plan/rollback/
escalation/checkpoint actions under anti-loop and side-effect rules. M19 coordinates 1–100 file change-set
DAGs with exact pre/post hashes, ownership, staging, verification, and preimage restoration on failure.

### M22 + intelligence A–C — Frontier evaluation, Benchmark 2.0, weakness mining

`src/frontier-evals` retains the M22 versioned model-alone versus model-plus-Odin matched evaluation
protocol with hidden acceptance metadata removed from model-facing input, equal identity/budget
requirements, complete/partial/inconclusive aggregation, and explicit infrastructure ambiguity.

The A-last profile envelope adds explicit hash-bound provider/model/profile/reasoning identity,
capability declarations, context/output ceilings, and bounded provenance without inferring capability from
a model name. Benchmark 2.0 adds a locked 100-case domain mix across coding, math, reasoning, tool use,
research, long context, recovery, and long missions while delegating matched-pair validity to M22. Phase C
turns typed sanitized diagnostics and attributable result failures into deterministic weakness heatmaps
and complete-pair baseline-vs-Odin deltas. None of these analytics can mint routing quality, completion,
tool, skill, sandbox, approval, credential, or release authority. Current Benchmark 2.0 results in tests
are fixtures, not a live Kimi benchmark claim.

### M25 — Tool ecosystem catalog

`src/tools/ecosystem.ts` defines uniform categories for repository, browser, database, cloud, documents,
data, CI/CD, API, and research adapters. Every descriptor must mirror one exact registered M3 manifest.
Discovery remains compact and execution always delegates through `ToolRuntime.execute`, preserving M3
policy, idempotency, retry/timeout, cancellation, and audit. Current category adapters are offline fixture
proof only, not live external integrations.

## Current module map

```text
src/
  mission/          M2 mission aggregate, DAG, state machine, budgets, checkpoints
  events/           append-only event contracts
  providers/        M1 provider-neutral model boundary
  tools/            M3 execution authority + M25 ecosystem catalog
  runtime/          M4/M16 coding orchestration + M19 multi-file coordinator
  reliability/      M17 typed failure/recovery policy
  verification/     M5 evidence verifier and adversarial review
  memory/           M6 scoped memory + M24 advanced retrieval/maintenance
  context/          M6/M18 context compiler, caching, deltas, snapshots
  coordination/     M7 specialist ownership and reconciliation
  durable/          M8 SQLite events/checkpoints/jobs/lifecycle
  autonomy/         M20 logical soak/recovery evidence
  client/           M9 protocol/controller/reconnect
  mobile/           M28 bounded mobile/native presentation and approval experience
  hosted/           M27 provider-neutral hosted service kernel
  skills/           M10 skill lifecycle and synthesis
  skill-intake/     M14 immutable bounded external-skill intake
  capability-packs/ M15 measured procedure curation and progressive packs
  skill-os/         M23 runtime pack discovery/selection/loading/rollback
  routing/          M11 empirical routing + M21 failure-aware route filtering
  frontier-evals/   M22 matched evaluation + A–C profile/Benchmark 2.0/weakness analytics
  sandbox/          M12 workspace/process/network/backend lifecycle + M26 strong-isolation contract
  observability/    M12 secret-safe bounded events
  release/          M12 recovery/backup/release evidence gates
  learning/         M13 evidence-backed repeated learning
  security/         shared secret-text and cross-cutting primitives
  artifacts/        content-addressed artifact layer direction
  cli/              user-facing CLI direction
web/                M9/M28 static responsive reference clients
```

## M26–M28 verified service boundaries (2026-09-06)

The production-shaped tranche extends existing authorities instead of creating parallel control planes:

- `src/sandbox/production.ts` is the M26 strong-isolation contract. Production isolation is limited to `container`, `microvm`, and `vm`; runtime attestation, exact policy/session binding, quotas, workspace/network restrictions, scoped secret resolution, cleanup fencing, and bounded audit evidence are mandatory. Adapters cannot turn host-process execution into production isolation.
- `src/hosted/service.ts` is the M27 provider-neutral hosted service kernel. Authentication, artifact, realtime, queue, backup, and audit systems are injected. M8 lease/generation/fencing semantics and M9 state/command contracts remain canonical; hosted infrastructure does not mint a second mission state machine.
- `src/mobile/experience.ts` is the M28 presentation/experience layer. It consumes M9 projections, does not import tool/sandbox/provider authority, treats cached state as read-only, and requires exact fresh server challenges plus fresh server command validation for high-impact approvals. Canonical long-running compute remains server-side.
- `web/mobile-reference.*` is a responsive reference fixture only. It stores neither credentials nor canonical mission state and is not evidence of a shipped native application.

These repository contracts are verified independently of vendor deployment. Real container/VM and hosted-service evidence remain external release gates.

## Intelligence package — Phase D–F (PR #36)

D–F extends `src/routing` as a provider-neutral, bounded amplification/evaluation layer while preserving
all earlier authorities:

- **Phase D** consumes only hash-valid, profile/benchmark-bound attributable Phase C evidence and emits
  bounded strategy recommendations. Unknown/infrastructure findings cannot masquerade as model reasoning
  weakness and strategy ceilings cannot exceed the caller/runtime plan.
- **Phase E** derives scaffolding only from explicit capability/profile declarations plus independent
  quality evidence. It validates every D strategy semantically, binds context to the exact profile, and
  cannot synthesize unsupported tool/structured-output capability or enlarge D budgets.
- **Phase F** revalidates D/E semantics against Benchmark 2.0 and creates an immutable
  `authority: evaluation_only`, `routingEligible: false`, `promotionEligible: false` candidate. It reports
  quality, efficiency, verification, recovery, repair, and weakness deltas without hiding incomplete or
  infrastructure evidence.

Package hardening run `34097050800` passed **492/492 tests** and explicitly guards against provider/model
name heuristics, direct tool/sandbox/provider/secret/network authority, recomputed-hash semantic smuggling,
budget drift, and analytics-to-routing escalation. Aggregate coverage was **90.02% lines / 76.67%
branches / 96.05% functions**. These are repository verification facts, not live model benchmark claims.

The package performed no live provider spend. Separately authorized post-merge live runs remain evaluation
evidence only until the existing M11/M21/M22/M5 authority and promotion requirements are satisfied.

## Chathub application boundary (G–I)

Background execution begins after the submission transaction commits. Nested actor operations share only
an active transaction; detached async continuations obtain a new transaction and reapply the role and
verified identity. Lease control uses a consistent resource → lease row → mission lock order. Pause and
cancel commit their state change together with lease deletion, so subsequent worker writes fail fencing.

`src/chat` connects the existing M2/M3/M5/M8/M12 contracts to an authenticated HTTP application.
The engine awaits a common conversation repository and the canonical mission EventStore. Local storage
uses SQLite; hosted storage uses Neon Postgres with forced RLS and verified managed Auth identities.
Short advisory-locked transactions serialize mission mutations. Network inference occurs outside those
transactions. Lease tokens fence late workers. Conversation history is bounded context, not mission authority.

`web/chat.*` renders real event replay and final responses. `api/index.ts` is the Vercel entry point;
`dist/public` is the deployed static output and `dist/web` preserves the original reference fixture.
The marketing landing owns `/`; the authenticated client owns `/app`. Mode links preselect only a
whitelisted mode and never dispatch a task. The landing renders no synthetic AI completions or live metrics.
Branch-scoped Vercel secrets select the separate `odin_app` login and the matching Neon Auth endpoint.
Its only role membership is non-inherited SET access to `odin_runtime`; no migration privileges are granted.
Hosted workspaces persist per tenant/conversation and support isolated static HTML previews and syntax
checks. They are not an arbitrary-code backend or M26 container implementation. For security and
deployment requirements, see `docs/CHATHUB_DEPLOYMENT.md`.
