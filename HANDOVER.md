# Engineering handover

Updated: 2026-09-04.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` contains verified M0–M14 at merge commit `48fc0074b6bd7df107b839ce0ce7bf1d877baa0c`.
- PR #19 M14 **Skill Intake Firewall** was squash-merged after final exact-head CI `33860283973` passed `npm run verify` on `916814fdbeb10ab91596dc286c65dab26c1e3f51`.
- M14 implementation baseline remains CI `33858888408`: **290/290 tests**, Biome PASS, strict TypeScript PASS, secret-free Kimi dry smoke PASS, aggregate coverage **89.47% lines / 76.70% branches / 95.84% functions**, and `skill-intake/firewall` coverage **90.20% / 79.74% / 98.61%**.
- Active work: M15 **Curated Capability Pack + offline improvement evaluation** on `agent/m15-curated-capability-pack`, created exactly from merged M14 main.
- M15 milestone contract is now committed at `docs/milestones/M15_CURATED_CAPABILITY_PACK.md`.
- The user explicitly authorized continuing through M15 and the bounded NVIDIA/Kimi K3 A/B comparison after measured M15 winners are integrated and verified.
- M12 remains partially verified for hosted-sandbox/public-production claims. No production deployment, paid resource, migration, billing change, or public traffic is authorized by this M15 work.

## M14 capability

`src/skill-intake` treats every community skill/plugin snapshot as untrusted data. A trusted resolver binds repository, requested ref, selected path, and one immutable 40-hex commit. Analysis is bounded by file count, per-file bytes, total bytes, path depth, and finding count. Opaque binaries/symlinks, unknown license state, truncation, invalid manifests, and incomplete inventory force `PARTIAL` and cannot silently become safe.

Static findings cover prompt override, credential collection, exfiltration, download-and-execute patterns, destructive writes, privilege escalation, self-promotion, policy/memory poisoning, dependency installation, explicit shell/subprocess use, MCP configuration, hooks/workflows, nested `.github/workflows`, and executable surfaces. Matched raw snippets are not persisted in findings; stable fingerprints and content hashes carry evidence identity.

Only `COMPLETE + ACCEPT` may be converted into an M10 `community` candidate. Intake forces `requiredTools=[]` and cannot activate a skill, register M3 handlers, create capabilities, expose credentials, change budgets/routing, or create completion evidence. M10 verification/promotion remains a separate authority boundary.

## External capability research for M15

Seven pinned source repositories remain immutable discovery/research inputs, not installed or executed:

- `ComposioHQ/awesome-claude-skills@be2a406907dbc61b73e6827ded415c96139d13a2` — broad community discovery/stress corpus; never transitive trust.
- `multica-ai/andrej-karpathy-skills@2c606141936f1eeef17fa3043a72095b4765b9c2` — explicit assumptions, simplicity/YAGNI, surgical edits, goal-driven verification. M15 adapts only additive discipline into Odin-owned policy/evals.
- `alirezarezvani/claude-skills@19392f7a08264ed00486a251f5b2098321771f94` — broad skill corpus. High-value reviewed procedures include `zero-hallucination-coder` and `deep-research`; their orchestration is not copied wholesale because it duplicates M2/M4/M5/M7.
- `anthropics/claude-plugins-official@1dd995193ba20bba51ca6c681aa8d3398dbd80a2` — marketplace/source metadata reference; third-party packages remain untrusted.
- `coreyhaines31/marketingskills@5cd4a7eae3a9a7b5d2aceb0613f7d1f7c4b65968` — product/ICP/positioning context plus domain marketing workflows. M6 remains canonical context/memory rather than `.agents` files.
- `anthropics/claude-code-security-review@0c6a49f1fa56a1d472575da86a94dbc1edb78eda` — diff-aware security review and false-positive filtering reference. Its own upstream prompt-injection warning prevents treating the action as trusted code.
- `0xNyk/awesome-hermes-agent@e4dde5e0e19b734c175a34038deac8e80cd04cb2` — Hermes ecosystem discovery reference only.

Additional design reference: `NVIDIA/SkillSpector` fail-closed completeness/resource-bound ideas; no dependency or copied scanner code.

## M15 implementation plan

1. Implement a deterministic curation contract that binds exact M10 candidate identity/hash, one domain, bounded task classes, runtime-owned procedure keys, and policy ceilings.
2. Deduplicate against canonical Odin behavior before evaluation. Fully redundant candidates must stop without gaining trust.
3. Add paired held-out evaluation: same fixture baseline vs candidate, integer quality basis points, safety/authority PASS, token/context and latency ceilings, minimum average lift, independent evidence only.
4. Convert only a passing independently produced report into exact-hash M10 verification. M15 must never activate a skill.
5. Add progressively loaded capability-pack registry for coding, research, security, data/documents, product/business, and marketing. Empty/unproven domains remain absent.
6. Add deterministic bounded offline replay that can only recommend RETEST/COMPRESS/DEDUPLICATE/REVIEW/KEEP and receives no mutation authority over M3/M5/M6/M10.
7. Add adversarial regressions for hash/scope/evidence mismatch, case ordering, quality/safety/authority regressions, context ceilings, pack lifecycle denial, and replay self-promotion attempts.
8. Synchronize ROADMAP/ARCHITECTURE/SECURITY/HANDOVER and obtain normal exact-head CI before merging M15.
9. After measured winners are integrated and verified, run the already user-authorized bounded NVIDIA/Kimi K3 A/B comparison with sanitized evidence and existing control-plane credential boundaries.

## Standing boundaries

- Repository evidence overrides documentation and memory; CI green is required before merge.
- M3 remains execution/capability authority; M5 remains completion/evidence authority; M10 remains skill promotion authority; M11 quality floors remain monotonic.
- Models/workers/skills/replay cannot mint credentials, capabilities, approval, budgets, quality evidence, trusted policy, or lifecycle promotion.
- External skills are discovery/candidate inputs only; Odin-owned distilled procedures must still pass M15 held-out evaluation before trusted registration/use.
- No secrets in commits/logs/artifacts. The authorized NVIDIA/Kimi comparison remains deferred until the M15 acceptance gate is satisfied.
