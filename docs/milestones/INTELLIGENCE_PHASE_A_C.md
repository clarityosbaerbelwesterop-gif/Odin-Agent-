# Intelligence amplification tranche — Phase A-last, B, C

Status: **VERIFIED**. This file is the binding delivery contract for one pull request containing exactly three sequential phases. Checked work is backed by repository evidence; benchmark fixtures are not reported as measured live-model improvement.

## Objective

Use the already integrated provider-neutral Odin runtime and the existing Kimi K3 evidence as the reference path while improving Odin itself. No new model/provider integration is part of this tranche.

1. **Phase A-last — evaluation profile envelope**: bind benchmark work to exact provider/model/profile/reasoning identity plus declared capability and output/context limits without inferring capability from a model name.
2. **Phase B — Benchmark 2.0**: extend M22 into a balanced, held-out, domain-aware benchmark contract covering coding, math, reasoning, tool use, research, long context, recovery, and long missions under equal matched-arm conditions.
3. **Phase C — weakness mining**: turn attributable benchmark failures and bounded diagnostics into a deterministic failure taxonomy and heatmap that identifies the highest-value Odin weaknesses without using hidden chain-of-thought or granting runtime authority.

## Invariants

- M3 remains tool/capability execution authority and M5 remains completion/evidence authority.
- M11/M21 routing quality floors remain monotonic; benchmark output does not become routing quality automatically.
- M22 matched-arm identity, hidden-acceptance separation, budget equality, incomplete infrastructure semantics, and anti-cherry-picking rules remain binding.
- Model output, benchmark output, diagnostics, and weakness reports are untrusted evidence/data, never authority.
- No raw prompts, model responses, repository contents, secrets, credentials, hidden acceptance text, or private chain-of-thought may be persisted in weakness evidence.
- Existing historical Kimi artifacts remain immutable. Derived weakness analysis is separate evidence and never rewrites a historical run.
- No live provider call, deployment, paid resource, migration, billing change, public traffic, or new credential is authorized by this tranche.
- A benchmark failure may motivate a later candidate improvement, but this tranche does not auto-promote skills, alter quality gates, weaken acceptance criteria, or modify production routing.

## Phase A-last — evaluation profile envelope

Acceptance criteria:

- [x] exact provider/model/profile/reasoning identity is hash-bound;
- [x] context/output ceilings and supported capability flags are validated independently of model names;
- [x] requested reasoning effort must be explicitly supported;
- [x] benchmark budgets that exceed profile context/output limits fail closed;
- [x] provenance is bounded and included in immutable profile identity;
- [x] deterministic tests cover ordering, tampering, unsupported effort, and over-budget rejection.

Verification evidence:

- exact phase-head CI: `34052663699` on `8ccd3a55077487d9572e6d0765984d9fd902cf41` — PASS.

## Phase B — Benchmark 2.0

Target domain mix for the default 100-case blueprint:

- coding: 25
- math: 20
- reasoning: 20
- tool use: 10
- research: 10
- long context: 5
- recovery: 5
- long mission: 5

Acceptance criteria:

- [x] M22 task taxonomy supports math, research, and long-context without weakening existing classes;
- [x] a versioned 100-case blueprint enforces the exact domain mix and unique held-out case identities;
- [x] model-facing projections still exclude hidden acceptance metadata;
- [x] every case is bound to one exact evaluation profile envelope and equal-condition budget;
- [x] aggregate reporting includes per-domain COMPLETE/PARTIAL/INCONCLUSIVE evidence rather than one misleading global score;
- [x] no synthetic fixture result is described as a live Kimi or public model benchmark.

Verification evidence:

- exact phase-head CI: `34053195605` on `dbd76086073ddddd1167ab8a482279ca32974ace` — PASS.

## Phase C — weakness mining

Acceptance criteria:

- [x] bounded typed diagnostic codes map into stable reasoning/coding/tool/context/model/verification/budget/infrastructure weakness classes;
- [x] unknown diagnostics remain `unknown` rather than being guessed into a favorable category;
- [x] heatmaps are deterministic, task/profile scoped, and sorted by measured frequency/severity;
- [x] infrastructure-ambiguous evidence remains separate from attributable model/Odin weaknesses;
- [x] baseline-vs-Odin weakness deltas cannot hide incomplete arms or reinterpret historical evidence;
- [x] the known M16 run-5 patterns (`repair_no_change`, `quality_failed_after_repair`, structured-output missing with `finishReason=length`) are covered as regression fixtures using only sanitized diagnostics.

Verification evidence:

- exact phase-head CI: `34090422186` on `7856c5c146b86efa12fe74455eafc058cd8ac15a` — PASS;
- full repository gate at that head: Foundation PASS, Biome PASS, strict TypeScript PASS, **470/470 tests PASS**, credential-free Kimi dry smoke PASS;
- Phase C weakness-mining module coverage at that gate: 91.41% lines, 72.32% branches, 100% functions.

## Adversarial review

Package-wide review was performed after Phase C against the standing M3/M5/M11/M21/M22 authority boundaries and this contract. The review found no release-blocking authority leak or evidence-integrity bypass:

- Benchmark 2.0 delegates pair validity, budgets, identity, anti-cherry-picking, and infrastructure ambiguity to M22 rather than reimplementing weaker rules.
- Profile capability declarations are explicit and hash-bound; model names do not mint capabilities.
- Weakness diagnostics are exact-schema, hash-bound, bounded, sanitized data. Raw provider/model messages and hidden acceptance content are absent from reports.
- Infrastructure-ambiguous results cannot be relabeled as attributable Odin/model weaknesses.
- Paired weakness deltas use only complete measurable matched pairs while incomplete-pair counts remain explicit.
- Weakness output creates no route, skill, completion, tool, approval, or release authority.
- Historical Kimi evidence is not modified.

No gate was weakened and no new live-provider, secret, deployment, billing, or migration action was introduced.

## Delivery gate

- [x] each phase received focused tests and full `npm run verify` before being declared complete;
- [x] package-wide adversarial review completed after Phase C;
- [x] `ARCHITECTURE.md`, `SECURITY.md`, `ROADMAP.md`, and `HANDOVER.md` synchronized;
- [ ] one fresh exact-head PR CI after governance synchronization;
- [ ] merge only after the final exact-head CI is green.
