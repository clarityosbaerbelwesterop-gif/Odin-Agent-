# M15 — Curated capability pack and offline improvement evaluation

Status: **IMPLEMENTATION_IN_PROGRESS**. Updated: 2026-09-04.

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

## Acceptance gate

M15 is VERIFIED only when the curation/evaluation contract, progressive pack boundary, offline replay,
held-out regressions, synchronized ROADMAP/ARCHITECTURE/SECURITY/HANDOVER, and normal exact-head
`npm run verify` are green in GitHub Actions.

Only after measured M15 winners are integrated and verified should the user-authorized bounded
NVIDIA/Kimi K3 A/B comparison run. That live comparison must use the existing control-plane secret
boundary and sanitized evidence, and one fixture must not be generalized into universal model
superiority.
