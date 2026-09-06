# Intelligence amplification tranche — Phase A-last, B, C

Status: **IN_PROGRESS**. This file is the binding delivery contract for one pull request containing exactly three sequential phases. Checked work requires repository evidence; benchmark intent is never reported as measured model improvement.

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

- [ ] exact provider/model/profile/reasoning identity is hash-bound;
- [ ] context/output ceilings and supported capability flags are validated independently of model names;
- [ ] requested reasoning effort must be explicitly supported;
- [ ] benchmark budgets that exceed profile context/output limits fail closed;
- [ ] provenance is bounded and included in immutable profile identity;
- [ ] deterministic tests cover ordering, tampering, unsupported effort, and over-budget rejection.

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

- [ ] M22 task taxonomy supports math, research, and long-context without weakening existing classes;
- [ ] a versioned 100-case blueprint enforces the exact domain mix and unique held-out case identities;
- [ ] model-facing projections still exclude hidden acceptance metadata;
- [ ] every case is bound to one exact evaluation profile envelope and equal-condition budget;
- [ ] aggregate reporting includes per-domain COMPLETE/PARTIAL/INCONCLUSIVE evidence rather than one misleading global score;
- [ ] no synthetic fixture result is described as a live Kimi or public model benchmark.

## Phase C — weakness mining

Acceptance criteria:

- [ ] bounded typed diagnostic codes map into stable reasoning/coding/tool/context/model/verification/budget/infrastructure weakness classes;
- [ ] unknown diagnostics remain `unknown` rather than being guessed into a favorable category;
- [ ] heatmaps are deterministic, task/profile scoped, and sorted by measured frequency/severity;
- [ ] infrastructure-ambiguous evidence remains separate from attributable model/Odin weaknesses;
- [ ] baseline-vs-Odin weakness deltas cannot hide incomplete arms or reinterpret historical evidence;
- [ ] the known M16 run-5 patterns (`repair_no_change`, `quality_failed_after_repair`, structured-output missing with `finishReason=length`) are covered as regression fixtures using only sanitized diagnostics.

## Delivery gate

Each phase receives focused tests and full `npm run verify` on the active PR before the next phase is declared complete. After Phase C, run package-wide adversarial review, synchronize `ARCHITECTURE.md`, `SECURITY.md`, `ROADMAP.md`, and `HANDOVER.md`, then require one fresh exact-head PR CI before merge.
