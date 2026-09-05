# M20–M22 — Long-running autonomy, multi-model routing, and frontier evaluation

Status: **VERIFIED_AWAITING_FINAL_EXACT_HEAD_CI**. Implementation and governance verification are complete; normal exact-head PR CI is the remaining technical merge gate. This document is the binding delivery contract for one pull request containing exactly three sequential milestones. A checked item requires repository evidence; intent is never marked complete.

## Package objective

Extend Odin from verified bounded coding/runtime primitives into a durable, evidence-preserving long-mission control plane and a model-neutral evaluation/routing layer without weakening any existing authority boundary.

1. M20 proves long-running autonomy through deterministic soak profiles and recovery integrity.
2. M21 routes among exact provider/model/profile identities only from empirical evidence that preserves quality floors and budgets.
3. M22 evaluates model-alone and model-plus-Odin under equal, reproducible conditions while keeping every score bound to the exact profile, task class, harness, and evidence version.

## Package invariants

- M3 remains execution/permission authority; M5 remains completion authority.
- M6 P0–P2 context remains mandatory and current repository/runtime evidence outranks memory.
- M8 durable events/checkpoints/jobs remain canonical for long-running execution; conversation/client state is never canonical.
- M11 quality floors are monotonic. Cost, speed, availability, or historical success may optimize only among candidates already satisfying the current quality requirement.
- M12 sandbox/network/credential boundaries remain fail closed.
- A model, worker, skill, evaluator, or benchmark result cannot mint tool grants, credentials, budget, completion evidence, routing quality, or release authority.
- No live provider call, deployment, paid resource, migration, billing change, or public traffic is part of this package unless separately authorized.

## M20 — Long-running autonomy

Goal: prove that a mission can remain bounded, recoverable, cancellable, and auditable across long logical durations and repeated interruptions.

- [x] Define versioned 6 h, 12 h, and 24 h soak profiles with explicit event, checkpoint, retry, failure-signature, recovery, and budget ceilings.
- [x] Drive soak evidence from a runtime-owned monotonic/synthetic clock so tests do not sleep for real hours and caller timestamps cannot extend deadlines.
- [x] Preserve exact checkpoint/event identity across simulated process restart and reject stale/tampered recovery evidence.
- [x] Prove expired leases are reclaimed at a higher generation and stale settlement cannot win after recovery.
- [x] Prove cancellation remains terminal across restart/reconnect and late success cannot resurrect work.
- [x] Track repeated equivalent failure signatures and block before an unbounded retry/no-progress loop.
- [x] Emit a deterministic soak report with duration coverage, restart count, recovery count, peak pending work, terminal state, budget consumption, and integrity hash.

Exit gate: deterministic 6 h, 12 h, and 24 h profiles all PASS with preserved recovery/integrity evidence; deliberate corruption, stale fencing, cancellation races, and retry-loop attempts fail closed; full repository verification passes.

## M21 — Multi-model router

Goal: make exact provider/model/profile selection depend on measured task-specific evidence, current budgets, availability, previous failures, and preserved quality floors.

- [x] Represent empirical model profiles for configured provider/model/profile/reasoning/task-class identities without inferring capabilities from names.
- [x] Require fresh independent quality evidence for the requested task class before a model can become eligible.
- [x] Apply quality-floor and required-capability filtering before cost, latency, availability, or preference ordering.
- [x] Incorporate previous typed failure signatures so a route does not blindly repeat a recently failed exact strategy/model profile.
- [x] Support deterministic escalation to a stronger eligible profile while preserving remaining call/token/cost ceilings.
- [x] Keep profile/evidence/cache identity bound to provider, model, profile version, reasoning effort, task class, and evidence version.
- [x] Add deterministic matrix tests covering Kimi, OpenAI, Anthropic, GLM, and OpenRouter-style identities using offline fixtures only; no real provider call is implied.

Exit gate: the offline routing matrix proves quality-before-cost selection, failure-aware rerouting, stale/foreign/tampered evidence rejection, deterministic escalation, and budget-safe blocking when no eligible route exists; full repository verification passes.

## M22 — Frontier evaluation suite

Goal: establish a reproducible benchmark protocol for model-alone versus model-plus-Odin without turning benchmark output into runtime authority. External-agent comparison requires a separately verified adapter/provenance contract and is not claimed by M22 v1.

- [x] Define a versioned 50–200 task suite spanning coding, reasoning, tool use, recovery, and long-mission control with bounded task inputs and expected evidence requirements.
- [x] Support hidden/held-out partitions whose expected answers/acceptance metadata are not exposed to the evaluated model path.
- [x] Enforce equal tool, call, token, time, and side-effect budgets between matched model-alone and model-plus-Odin arms unless the profile explicitly declares and reports a difference.
- [x] Record quality, completion, verification, token, latency, call, repair, recovery, and failure-category outcomes only for complete attributable arms.
- [x] Keep incomplete/infrastructure-ambiguous arms separate from deterministic task failures and never convert missing pairs into numeric zero lift.
- [x] Bind every result to suite version, case hash, arm, provider/model/profile, task class, budget profile, harness version, and evidence hash.
- [x] Produce deterministic aggregate summaries that distinguish COMPLETE, PARTIAL, and INCONCLUSIVE evidence and cannot be used as M5 completion or M11 quality evidence without a separate independent promotion step.

Exit gate: an offline 50+ case fixture suite reproduces identical aggregate evidence independent of input order, detects budget/harness asymmetry and hidden-answer leakage, preserves partial/inconclusive semantics, and passes all repository gates.

## Verified implementation evidence

Final adversarial hardening run `33951098718` passed **408/408 tests**, Biome, strict TypeScript,
credential-free Kimi dry smoke, and `npm run build`. Aggregate coverage was **90.29% lines / 77.60%
branches / 96.09% functions**. Focused coverage was **86.16% / 74.31% / 100%** for the M20 soak
engine, **88.36% / 76.27% / 100%** for M21 failure-aware routing, and **91.48% / 78.76% / 100%**
for the M22 frontier-evaluation suite.

M20's 6 h, 12 h, and 24 h results are logical-duration synthetic-clock proofs, not wall-clock uptime
claims. The runtime rejects unknown or misplaced soak-event fields before hashing and again on replay;
restart evidence binds the latest checkpoint, lease generations fence stale settlement, cancellation
beats late success, and equivalent failure signatures are bounded.

M21's five-provider matrix is an **offline identity/evidence fixture**. It proves that recent typed
failures can only remove exact routes before the existing M11 quality/capability/budget router runs;
negative failure evidence cannot lower a quality floor, add budget, or create positive evaluation
quality. No provider name implies a capability and no live provider was called.

M22's 60-case held-out fixture validates the protocol and aggregation semantics with synthetic outcomes;
it is **not** a real frontier-model benchmark result. Hidden acceptance metadata is omitted from the
model-facing projection, matched arms require the same provider/model/profile/reasoning/harness/budget,
per-case ceilings are enforced, two results for one arm cannot be cherry-picked, deterministic terminal
task failures remain measurable negatives, and infrastructure-ambiguous pairs remain unscored. Zero
complete pairs is INCONCLUSIVE rather than numeric zero lift. External-agent baselines are not
implemented or claimed in this v1 package.

## Verification and delivery

Each milestone receives focused deterministic tests and a full `npm run verify` checkpoint before advancing. After M22, the combined diff receives adversarial review, governance/documentation synchronization, one final full verification, and normal exact-head pull-request CI. Merge remains separately approval-gated.

## Explicit non-goals

- No real 6/12/24-hour wall-clock test is claimed from synthetic-clock evidence.
- No live multi-provider spend or public benchmark sweep is authorized by this contract.
- No provider/model is declared universally best from offline fixtures.
- No benchmark score can bypass M3, M5, M10, M11, M12, or release authority.
- No AGI/ASI, zero-error, universal token-savings, or universal model-equivalence claim follows from this package.
