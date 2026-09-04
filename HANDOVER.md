# Engineering handover

Updated: 2026-09-04.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` contains verified M0–M14 at merge commit `48fc0074b6bd7df107b839ce0ce7bf1d877baa0c`.
- Active work: PR #20 M15 **Curated Capability Pack + offline improvement evaluation** on `agent/m15-curated-capability-pack`.
- Hardened implementation checkpoint: `075c46d301c53521cdb10e713d57d3f45386c244`.
- Helper run `33866236138` passed **319/319 tests**, Biome, strict TypeScript, and secret-free Kimi dry smoke; aggregate coverage **89.81% lines / 77.03% branches / 95.85% functions**.
- Final M15 hardening binds evidence freshness to a trusted runtime clock, rejects self-declared procedure novelty outside the runtime-owned domain catalog, and records live A/B arm failures as explicit negative sanitized measurements.
- M15 curation/pack/replay infrastructure is implementation-verified, but no distilled candidate is ACTIVE and no domain pack is claimed populated without measured passing evidence.
- The user explicitly authorized merge after normal exact-head CI is green, then one bounded NVIDIA/Kimi K3 bare-model-vs-Odin A/B comparison. That comparison is task-specific evidence, not a public benchmark or AGI claim.
- M12 remains partially verified for hosted-sandbox/public-production claims. No production deployment, paid resource, migration, billing change, or public traffic is authorized by this work.

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

## M15 completion and post-merge evidence plan

1. Synchronize ROADMAP/ARCHITECTURE/SECURITY/M15 milestone/HANDOVER with helper-run evidence.
2. Obtain one normal exact-head `npm run verify` on the synchronized PR head; do not bypass `action_required` or any failed quality gate.
3. If green, mark PR #20 ready and merge under the user's explicit authorization.
4. From merged `main`, create a fresh benchmark-evidence branch and run one bounded NVIDIA `moonshotai/kimi-k3` baseline-vs-Odin coding A/B with sanitized evidence only.
5. Treat public Kimi K3 benchmark numbers and Odin's matched A/B as different evidence classes. Compare patterns and deltas, never splice Odin fixture percentages into vendor leaderboard scores.
6. If the candidate passes exact M15 gates, register only that exact measured candidate/report in a progressive pack; otherwise preserve the negative evidence and leave the pack absent.
7. Use the same matched A/B protocol for other provider/model identities later. Architectural reliability gains may transfer across models; measured lift magnitude must be re-established per model/profile/task class.

## Standing boundaries

- Repository evidence overrides documentation and memory; CI green is required before merge.
- M3 remains execution/capability authority; M5 remains completion/evidence authority; M10 remains skill promotion authority; M11 quality floors remain monotonic.
- Models/workers/skills/replay cannot mint credentials, capabilities, approval, budgets, quality evidence, trusted policy, or lifecycle promotion.
- External skills are discovery/candidate inputs only; Odin-owned distilled procedures must still pass M15 held-out evaluation before trusted registration/use.
- No secrets in commits/logs/artifacts. The authorized NVIDIA/Kimi comparison remains deferred until the M15 acceptance gate is satisfied.
