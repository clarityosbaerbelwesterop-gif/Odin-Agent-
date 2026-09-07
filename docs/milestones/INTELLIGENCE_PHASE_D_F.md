# Intelligence amplification tranche — Phase D, E, F

Status: **IN_PROGRESS**. This is the binding contract for one pull request containing exactly three sequential phases after the merged A–C intelligence tranche.

## Objective

Improve Odin's own reasoning/scaffolding rather than adding model/provider integrations. Kimi K3 remains the existing reference identity for historical/evaluation continuity, while all new logic remains provider-neutral and capability/evidence-driven.

1. **Phase D — intelligence/reasoning amplification**: convert attributable Phase C weakness evidence into bounded, deterministic runtime strategy recommendations for planning, decomposition, context, tool grounding, critique, verification, and repair.
2. **Phase E — weak-model amplification**: adapt Odin scaffolding to explicit lower-capability evaluation envelopes without inferring weakness from model names or lowering M11/M21 quality floors.
3. **Phase F — frontier amplification**: compose the strongest bounded D/E policies into an evaluation-only candidate configuration and measure it through the existing Benchmark 2.0/M22 evidence protocol before any routing consequence is possible.

## Standing invariants

- M3 remains the only tool/capability execution authority.
- M5 remains completion/evidence authority.
- M10 remains skill lifecycle authority.
- M11/M21 quality floors, capability requirements, budgets, and failure exclusions cannot be weakened by D–F.
- M22/Benchmark 2.0 matched identity, equal-condition budget, hidden-acceptance separation, anti-cherry-picking, and infrastructure-ambiguity semantics remain binding.
- Phase C weakness reports and D–F strategy/configuration objects are untrusted evidence/policy inputs until exact runtime validation; they cannot mint runtime authority.
- No model name may imply capability, weakness, reasoning support, context size, or output support.
- No benchmark fixture, synthetic result, or offline candidate may be reported as a live Kimi/public model improvement.
- Historical Kimi artifacts are immutable.
- No new model/provider integration, live provider call, paid resource, deployment, production migration, billing change, public traffic, or new credential is authorized by this tranche.
- Every amplification path is bounded by explicit calls/tokens/context/critique/repair/tool ceilings and fails closed on malformed, stale, foreign, tampered, or contradictory evidence.

## Phase D — intelligence/reasoning amplification

Acceptance criteria:

- [ ] strategy input binds exact Phase C weakness-report hash, benchmark/profile identity, task domain, and bounded risk/complexity signals;
- [ ] deterministic strategy selection covers planning/decomposition, context retrieval, tool grounding, critique, verification, and repair reserves;
- [ ] strategy ceilings can preserve or reduce existing budgets but never increase beyond caller/runtime-owned maxima;
- [ ] infrastructure/unknown weaknesses cannot masquerade as attributable reasoning/coding/tool/context/model weaknesses;
- [ ] absent or weak evidence yields a conservative bounded default rather than speculative amplification;
- [ ] strategy output has no tool, route, completion, approval, skill, credential, sandbox, or release authority;
- [ ] focused tests cover tampering, foreign profile/report, budget escalation, unknown/infra evidence, deterministic ordering, and known M16 weakness patterns;
- [ ] full `npm run verify` passes before Phase D is declared complete.

## Phase E — weak-model amplification

Acceptance criteria:

- [ ] lower-capability classification is derived only from explicit evaluation-profile capability/context/output declarations plus independent quality evidence, never the model name;
- [ ] a bounded amplification plan may strengthen decomposition, context shaping, tool grounding, structured-output framing, verification depth, and reserved repair capacity;
- [ ] unsupported capabilities are never synthesized or claimed by Odin scaffolding;
- [ ] amplification cannot lower M11/M21 quality floors, bypass route exclusion, increase runtime-owned budgets, or become positive routing evidence;
- [ ] stronger profiles do not receive unnecessary scaffolding solely because of identity/provider names;
- [ ] deterministic tests compare explicit lower/higher capability envelopes and prove fail-closed stale/tampered/insufficient quality evidence handling;
- [ ] full `npm run verify` passes before Phase E is declared complete.

## Phase F — frontier amplification

Acceptance criteria:

- [ ] one immutable candidate configuration composes verified D/E policy components with exact hashes/versions/bounds;
- [ ] candidate evaluation reuses Benchmark 2.0/M22 matched-arm semantics and cannot alter hidden acceptance, per-case budgets, provider/model/profile/reasoning identity, or infrastructure classification;
- [ ] reports separate quality, token, latency, verification, recovery, and weakness deltas by domain without cherry-picking incomplete evidence;
- [ ] candidate fixtures prove protocol behavior only and create no M11 route-quality or production-promotion authority;
- [ ] any future live claim requires separately authorized immutable provider evidence under the same profile/configuration identity;
- [ ] adversarial tests cover candidate tampering, component substitution, budget inflation, incomplete-arm hiding, profile mismatch, and analytics-to-routing authority escalation;
- [ ] full `npm run verify` passes before Phase F is declared complete.

## Delivery gate

- [ ] Phase D focused tests + full verify complete;
- [ ] Phase E focused tests + full verify complete;
- [ ] Phase F focused tests + full verify complete;
- [ ] package-wide adversarial review complete;
- [ ] `ARCHITECTURE.md`, `SECURITY.md`, `ROADMAP.md`, and `HANDOVER.md` synchronized;
- [ ] one fresh normal exact-head PR CI after governance synchronization;
- [ ] merge only after the final exact-head CI is green and explicit merge authorization remains valid.
