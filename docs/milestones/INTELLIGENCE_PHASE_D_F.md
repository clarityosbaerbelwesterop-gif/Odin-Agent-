# Intelligence amplification tranche — Phase D, E, F

Status: **PACKAGE_VERIFIED — final exact-head merge gate pending**. This is the binding contract for one pull request containing exactly three sequential phases after the merged A–C intelligence tranche.

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

- [x] strategy input binds exact Phase C weakness-report hash, benchmark/profile identity, task domain, and bounded risk/complexity signals;
- [x] deterministic strategy selection covers planning/decomposition, context retrieval, tool grounding, critique, verification, and repair reserves;
- [x] strategy ceilings can preserve or reduce existing budgets but never increase beyond caller/runtime-owned maxima;
- [x] infrastructure/unknown weaknesses cannot masquerade as attributable reasoning/coding/tool/context/model weaknesses;
- [x] absent or weak evidence yields a conservative bounded default rather than speculative amplification;
- [x] strategy output has no tool, route, completion, approval, skill, credential, sandbox, or release authority;
- [x] focused tests cover tampering, foreign profile/report, budget escalation, unknown/infra evidence, deterministic ordering, and known M16 weakness patterns;
- [x] full `npm run verify` passes before Phase D is declared complete.

Phase D exact-head PR CI `34091888679` passed after the formatter-only repair.

## Phase E — weak-model amplification

Acceptance criteria:

- [x] lower-capability classification is derived only from explicit evaluation-profile capability/context/output declarations plus independent quality evidence, never the model name;
- [x] a bounded amplification plan may strengthen decomposition, context shaping, tool grounding, structured-output framing, verification depth, and reserved repair capacity;
- [x] unsupported capabilities are never synthesized or claimed by Odin scaffolding;
- [x] amplification cannot lower M11/M21 quality floors, bypass route exclusion, increase runtime-owned budgets, or become positive routing evidence;
- [x] stronger profiles do not receive unnecessary scaffolding solely because of identity/provider names;
- [x] deterministic tests compare explicit lower/higher capability envelopes and prove fail-closed stale/tampered/insufficient quality evidence handling;
- [x] full `npm run verify` passes before Phase E is declared complete.

Phase E exact-head PR CI `34092487219` passed after the explicit runtime-domain type guard repair.

## Phase F — frontier amplification

Acceptance criteria:

- [x] one immutable candidate configuration composes verified D/E policy components with exact hashes/versions/bounds;
- [x] candidate evaluation reuses Benchmark 2.0/M22 matched-arm semantics and cannot alter hidden acceptance, per-case budgets, provider/model/profile/reasoning identity, or infrastructure classification;
- [x] reports separate quality, token, latency, verification, recovery, repair, and typed attributable-failure deltas by domain without cherry-picking incomplete evidence;
- [x] candidate fixtures prove protocol behavior only and create no M11 route-quality or production-promotion authority;
- [x] any future live claim requires separately authorized immutable provider evidence under the same profile/configuration identity;
- [x] adversarial tests cover candidate tampering, component substitution, budget inflation, incomplete-arm preservation, profile mismatch, and analytics-to-routing authority escalation;
- [x] full `npm run verify` passes before Phase F is declared complete.

Phase F helper run `34095778033` applied Biome formatting and passed full `npm run verify`; the fresh normal Phase F PR CI `34095946506` then passed on a user-authored checkpoint. Package-wide semantic hardening run `34097050800` subsequently passed **492/492 tests**, Biome, strict TypeScript, credential-free Kimi dry smoke, and aggregate coverage **90.02% lines / 76.67% branches / 96.05% functions**. That adversarial review also closed recomputed-hash semantic smuggling, D/E budget drift, capability/profile mismatch, and repair-policy mismatch before governance synchronization.

## Delivery gate

- [x] Phase D focused tests + full verify complete;
- [x] Phase E focused tests + full verify complete;
- [x] Phase F focused tests + full verify complete;
- [x] package-wide adversarial review complete;
- [x] `ARCHITECTURE.md`, `SECURITY.md`, `ROADMAP.md`, and `HANDOVER.md` synchronized;
- [ ] one fresh normal exact-head PR CI after governance synchronization;
- [ ] merge only after the final exact-head CI is green and explicit merge authorization remains valid.

Package adversarial evidence: run `34097050800`, **492/492 tests**, aggregate coverage **90.02% lines / 76.67% branches / 96.05% functions**. The final merge still requires a new normal CI on the exact governance head; this document does not pre-claim that result.
