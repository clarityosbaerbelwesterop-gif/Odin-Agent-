# Engineering handover

Updated: 2026-09-04.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` contains verified M0–M12; active work is M13 on `agent/m13-evidence-learning`, Draft PR #18.
- M13 implementation head after replay/maintenance hardening: `6165114201d151240125ec890b3560b631f6502b`.
- Implementation verification run `33852005166`: 272/272 tests, Biome PASS, strict TypeScript PASS, dry Kimi smoke PASS, 89.42% line / 76.50% branch / 95.67% function coverage.
- No temporary M13 helper workflow remains after the implementation commit. Documentation is synchronized before the final normal exact-head PR CI.
- M12 remains partially verified for hosted-sandbox/public-production claims; do not spend money, create paid resources, deploy production, or repeat live-provider calls without explicit authorization.

## M13 capability

M13 turns repeated independently verified task outcomes into lower-authority learning without letting a model manufacture trust. Exact learning key/content hashes and M5-backed evidence are required; three distinct verified task identities establish a lesson. Conflicting lessons block nudges and memory promotion. Exact replay is idempotent without fresh evidence lookup, changed replay input fails closed, and asynchronous replay races remain checked.

Established learning may commit to M6 semantic memory only with `verified_learning` provenance. General semantic retrieval hides it unless `m13-learning` is explicitly requested. Secret-like values are rejected across the lesson, semantic key, tags, and source references. M13 never creates M3 execution authority, M5 completion, M10 activation, credentials, budget, routing-floor changes, or inferred durable preferences.

## External capability research for M14/M15

Five user-supplied repositories were reviewed as immutable research snapshots, not installed or executed:

- `ComposioHQ/awesome-claude-skills@be2a406907dbc61b73e6827ded415c96139d13a2` — broad community discovery catalog and MCP/action examples; useful for breadth/stress testing, never transitive trust.
- `multica-ai/andrej-karpathy-skills@2c606141936f1eeef17fa3043a72095b4765b9c2` — coding discipline: surface assumptions, prefer simplicity, make surgical edits, define verifiable success. Adapt into Odin-owned policy/evals rather than higher-authority external instructions.
- `alirezarezvani/claude-skills@19392f7a08264ed00486a251f5b2098321771f94` — hundreds of skills plus scripts/hooks, self-improving memory, agent harness, research, security, business and marketing. High-value M14 stress corpus with a large executable/supply-chain surface.
- `anthropics/claude-plugins-official@1dd995193ba20bba51ca6c681aa8d3398dbd80a2` — official marketplace reference with repository/path/ref/commit SHA and explicit skill subsets, while warning users not to assume third-party plugins are safe.
- `coreyhaines31/marketingskills@5cd4a7eae3a9a7b5d2aceb0613f7d1f7c4b65968` — strong domain workflows for product context, CRO, copy, SEO/AEO, pricing, launch, analytics, sales and recurring marketing loops; shared product context and disagreement/council patterns map well to M6/M7/M11.

No third-party code from these repositories was executed or copied into Odin during this review.

## Next milestones

1. Obtain final normal exact-head `npm run verify` for synchronized M13 PR #18, update evidence status, then squash-merge under the user's standing merge approval.
2. Create fresh M14 branch from merged `main`: **Skill Intake Firewall**. Discover broadly, resolve mutable refs to exact commits, scan bounded manifests/scripts/hooks/MCP/config content without executing it, emit explicit completeness/risk findings, quarantine partial scans, and hand only fully analyzed community candidates to M10.
3. M15: **Curated Capability Pack + offline improvement evaluation**. Deduplicate candidate procedures against Odin's canonical runtime, evaluate output lift/safety/context cost on held-out fixtures, then promote only measured winners through M10. Add bounded offline sleep/replay proposals that cannot self-promote.
4. Keep future scheduler/triggers/background missions and permissioned MCP/Agent-Skills adapters as separate no-cost milestones before public production deployment.

## Standing boundaries

- Repository evidence overrides documentation and memory; CI green is required before merge.
- M3 remains execution/capability authority; M5 remains completion/evidence authority; M10 remains skill promotion authority.
- Models/workers/skills/memory cannot mint credentials, capabilities, approval, budgets, quality evidence, or trusted policy.
- External skill catalogs are discovery inputs only until exact-source analysis and M10 lifecycle requirements succeed.
- No secrets in commits/logs/artifacts, no paid/live infrastructure actions without explicit user approval.
