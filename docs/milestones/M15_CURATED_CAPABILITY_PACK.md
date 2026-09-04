# M15 — Curated capability pack and offline improvement evaluation

Status: **VERIFIED**. Updated: 2026-09-04.

## Objective

Turn the safest, genuinely additive procedures discovered through M14 into measured Odin capability
improvements without importing external prompt stacks as higher authority. M15 must prove that a
candidate improves a deterministic held-out task set while preserving M3 authority, M5 evidence,
M10 lifecycle controls, M11 quality floors, and bounded context/cost.

M15 is an evidence and packaging layer. It does not let a model, external skill, replay loop, or pack
self-activate, manufacture verification evidence, change policy, mint credentials/capabilities, or
raise mission budgets.

## Design principles

1. **Deduplicate before evaluating.** Runtime-owned procedure keys identify behavior Odin already owns
   through M2/M4/M5/M7/M10/M11. A candidate with no novel procedure is redundant and is not promoted.
2. **Paired held-out evidence.** Every candidate is compared against a no-candidate baseline on the same
   deterministic fixtures. Quality, safety, authority, token/context cost, and latency are explicit.
3. **Quality floor first.** Cost/latency savings never compensate for a quality, safety, or authority
   regression. Every case must preserve its required quality floor.
4. **Independent promotion.** Only independently produced PASS evaluation evidence bound to the exact
   M10 package hash may verify a community candidate. M15 never calls M10 activation.
5. **Progressive packs.** Pack discovery remains compact. Full instructions resolve through M10 only for
   exact VERIFIED/ACTIVE members and remain bounded by runtime-owned context ceilings.
6. **Offline replay proposes only.** Sleep/replay can recommend retest, compression, deduplication, or
   review. It cannot mutate M10/M6/M3/M5 state or treat its own output as evidence.

## Initial external procedure research

Research inputs remain immutable discovery material, not authority:

- Karpathy-derived coding discipline contributes explicit assumption surfacing, simplicity/YAGNI,
  surgical changes, and goal-driven verification. Odin already owns planning/repair/verification, so
  M15 should evaluate only the additive discipline rather than copy a second orchestration loop.
- `zero-hallucination-coder` contributes KNOWN/INFERRED/UNKNOWN mapping, no invented APIs/imports, and a
  minimality check. User-confirmation-per-story and raw external orchestration are intentionally not
  imported because they conflict with Odin's autonomous runtime and duplicate M2/M4/M5.
- `deep-research` contributes falsifiable hypotheses, opposition queries, source-type diversity,
  explicit insufficient-evidence states, adversarial synthesis, and refresh targets. M7/M5/M6 remain
  the execution, verification, and memory authorities.
- Anthropic's security-review reference contributes diff-aware attack-surface review, concrete exploit
  paths, comparison against the repository security model, and false-positive filtering. Its own
  upstream warning about prompt injection means the external action is never trusted or executed.
- Marketing Skills contributes a reusable product/ICP/positioning context schema and specialized
  product/business/marketing procedures. Durable product context must map into M6 rather than creating
  a second canonical `.agents` memory store.

## Curation contract

A curation request binds:

- exact candidate `name + version + contentHash` already present in M10;
- one domain: `coding`, `research`, `security`, `data-documents`, `product-business`, or `marketing`;
- bounded task-class identifiers;
- bounded runtime-owned `procedureKeys`;
- bounded candidate-context bytes and an explicit evaluation policy.

Canonical procedure keys are supplied by trusted runtime configuration. M15 compares the candidate keys
against that canonical set before requesting evaluation. Redundant candidates cannot create new trust.

## Paired evaluation contract

Each held-out case contains the same task identity plus baseline and candidate measurements:

- integer `qualityBps` from 0–10000;
- `safety` PASS/FAIL;
- `authority` PASS/FAIL;
- non-negative integer token count and latency;
- case quality floor plus token/latency ceilings;
- non-empty independent evidence references.

A candidate is eligible only when every case:

- preserves or improves baseline quality;
- meets the case quality floor;
- passes safety and authority checks;
- remains inside token/latency ceilings.

Aggregate candidate quality must also beat baseline by the configured minimum average lift. Evaluation
policy is runtime-owned and bounded; a candidate cannot lower its own threshold.

The resulting report is deterministic, hash-addressed, and contains no private reasoning. PASS may be
converted into M10 independent verification evidence for the exact package hash. FAIL/REDUNDANT/BLOCKED
never changes M10 lifecycle.

## Progressive pack contract

A pack contains only measured members and compact metadata:

- stable pack id/version and one domain;
- exact member name/version/content hash;
- bounded task classes and aggregate instruction/context byte accounting;
- curation report references/hashes;
- deterministic pack hash.

Registration requires every member to be M10 VERIFIED/ACTIVE at the exact hash. Pack discovery returns
metadata only. Resolving a member delegates to normal M10 resolution, so CANDIDATE/REVOKED content and
pack-level attempts to bypass M10 remain denied.

Initial target packs after measured evaluation:

- coding;
- research;
- security;
- data/documents;
- product/business;
- marketing.

Empty or unproven domains remain absent rather than being filled with speculative skills.

## Bounded offline replay

Offline replay accepts only prior immutable curation summaries and bounded policy. It may emit proposal
records such as `RETEST`, `COMPRESS`, `DEDUPLICATE`, `REVIEW`, or `KEEP`. Proposals contain rationale
codes and evidence references, not hidden reasoning.

The replay API receives no SkillRegistry mutation interface, M6 memory writer, M3 registry/policy,
credential resolver, or M5 verifier. Tests must demonstrate that replay output alone cannot verify,
activate, register tools, or create evidence.

## Required deterministic regressions

1. novel candidate + independently produced paired PASS evidence -> M10 VERIFIED, never ACTIVE;
2. fully redundant candidate -> REDUNDANT without evaluation or lifecycle change;
3. exact candidate/hash mismatch, stale/foreign evidence, malformed cases, duplicate case ids -> fail closed;
4. any quality-floor, safety, authority, token, or latency regression -> no verification;
5. aggregate lift below configured floor -> no verification;
6. case ordering cannot change report or hash;
7. model/runtime/worker self-evaluation cannot establish M10 verification;
8. pack registration rejects candidate/revoked/hash-mismatched members;
9. progressive pack discovery omits full instructions and exact resolve still flows through M10;
10. pack member/context ceilings fail closed;
11. replay is deterministic, bounded, and proposal-only;
12. replay cannot self-promote, manufacture M5 evidence, create M3 tools, or mutate M6 memory;
13. coding policy/evals encode assumption grounding, minimal/surgical changes, and acceptance-evidence
    mapping without importing a second orchestration authority;
14. research/security/product-marketing adaptations reuse M7/M5/M6 instead of duplicating authority or
    canonical state.

## Implementation evidence

Final hardening helper run `33866236138` passed 319/319 tests plus Biome, strict TypeScript, and the secret-free Kimi dry smoke before checkpointing commit `075c46d301c53521cdb10e713d57d3f45386c244`. Aggregate coverage was 89.81% lines / 77.03% branches / 95.85% functions; curator coverage was 95.48% / 81.05% / 97.22%, pack registry 90.43% / 77.88% / 95.24%, and replay 92.86% / 89.74% / 100%.

Review-found hardening makes evaluation freshness depend on a trusted runtime clock, denies procedure keys outside the runtime-owned canonical/additive domain catalogs, binds pack membership to the same M15 evidence that established M10 verification, and records interrupted live A/B arms as conservative explicit failures rather than dropping negative evidence.

Normal exact-head PR CI `33870080147` passed before PR #20 was merged. PR #20 was then squash-merged into `main` as `30bcab22f6129925b704fff0d024ca40e472b06c`, satisfying the M15 acceptance gate.

This verifies the M15 curation/pack/replay mechanism. It does **not** claim that any distilled candidate is ACTIVE, that an unmeasured domain pack is populated, that Kimi K3 or another model gained a specific public-benchmark score, or that Odin is AGI/ASI.

## Post-merge Kimi evidence

Authorized run `33870210502` attempted three matched NVIDIA `moonshotai/kimi-k3` coding cases and used ten provider calls. All six baseline/candidate arms were incomplete, so the evidence is **INCONCLUSIVE** with zero complete pairs and no defensible quality delta. Historical raw evidence remains at `docs/evals/m15-kimi-coding-ab.json`; its separate interpretation prevents a numeric zero from being mistaken for measured zero lift.

Second authorized run `33879714040` repeated the same three matched cases after the fail-closed evidence-semantics repair. It used nine provider calls and again produced zero complete pairs, therefore **INCONCLUSIVE** with null baseline quality, candidate quality, and lift. The sanitized result is preserved at `docs/evals/m15-kimi-coding-ab-rerun-2.json`, with analysis in `docs/evals/M15_KIMI_CODING_AB_RERUN_2_ANALYSIS.md`.

All six rerun-2 arms ended with `ProviderError / provider_timeout`. Candidate arms used one call, reached about 180 seconds, and had no target mutation. Baseline arms used two calls, had already mutated the target after planning, did not match deterministic expected content, and timed out during bounded repair. This localizes the failure position without inventing a model-quality result.

Review found a live-measurement defect: v1 used 180000 ms for both provider timeout and candidate latency acceptance. A run exceeding the acceptance ceiling could therefore be aborted before it became a complete latency FAIL. The offline repair introduces versioned profile `m15-kimi-coding-ab-v2`: 180000 ms acceptance, 240000 ms provider measurement timeout, at least 30000 ms required headroom, 2 calls per arm, 12 total calls, `high` reasoning, temperature 1. Profile identity is included in evidence and sanitized metadata.

One-shot offline hardening run `33882837781` passed **329/329 tests**, Biome, strict TypeScript, build, secret-free Kimi dry smoke, and credential-free A/B dry-run assertions. Aggregate coverage was **89.92% lines / 77.25% branches / 95.88% functions**; the new live-profile module reached **91.84% / 88.89% / 100%**. It made no live provider request.

Neither live attempt verifies `odin-coding-discipline`, populates a pack, activates a skill, changes public Kimi benchmark scores, or supports an AGI/Astra/Fable superiority claim. A third live comparison requires new explicit user authorization.

## Acceptance gate

M15 itself is VERIFIED: the curation/evaluation contract, progressive pack boundary, offline replay,
held-out regressions, synchronized governance documents, and normal exact-head `npm run verify` were
green before merge.

A live capability candidate still requires complete matched provider evidence that satisfies the normal
M15 quality, safety, authority, token, and latency gates. Incomplete evidence cannot promote a candidate.
A new live provider rerun requires separate user authorization.

## Third authorized Kimi comparison — v2

Run `33884808665` exercised the three matched coding cases with NVIDIA `moonshotai/kimi-k3` under `m15-kimi-coding-ab-v2`. All preflight gates passed and the live step used 10/12 maximum provider calls. The immutable raw result initially reports INCONCLUSIVE because that runner version marked all thrown errors incomplete.

Review identified an evidence-semantics defect: deterministic terminal task failures were being conflated with interrupted/ambiguous measurements. The repaired contract counts a narrow runtime-owned set of terminal failures as complete negative evidence while keeping transient/ambiguous provider categories incomplete. It does not classify generic `provider_malformed_response` as terminal because that category can represent transport or response-shape ambiguity.

Applied to preserved rerun-3 diagnostics, the defensible result is **PARTIAL** with 2/3 complete pairs. `retry-429-surgical` and `safe-trim-existing-api` are quality 0 vs 0 with 0 bps candidate lift; `canonical-user-id` remains incomplete due to candidate `provider_malformed_response`. Thus `odin-coding-discipline@m15v1` remains unverified/unactivated from live evidence.

A deterministic exact-fixture control then passed all three cases first-pass through Odin M4 tools/quality and M5 verification. Normal PR CI `33888060837` passed 336/336 tests with aggregate coverage 89.99% lines / 77.41% branches / 95.89% functions. The immediate bottleneck is therefore live Kimi/provider plan/repair reliability, not fixture solvability. A fourth live comparison requires new explicit authorization.
