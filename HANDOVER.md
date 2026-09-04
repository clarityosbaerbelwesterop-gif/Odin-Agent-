# Engineering handover

Updated: 2026-09-04.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` contains verified M0–M15 plus PR #21 post-run evidence hardening at merge commit `02d80898cd10416c0198007280aca7447bbb7573`.
- Active work: `agent/m15-kimi-rerun-2`, preserving the second authorized Kimi K3 A/B evidence and hardening the live measurement profile before any future provider run.
- Second authorized live run `33879714040` completed successfully at the workflow level and used **9/12** maximum provider calls across the same three matched coding cases. All three matched pairs remain incomplete, so the result is **INCONCLUSIVE** with null quality/lift.
- Every arm ended with bounded diagnostic `ProviderError / provider_timeout`. Candidate arms used one call, timed out at about 180 seconds, and made no target mutation. Baseline arms used two calls, mutated the target after planning, failed deterministic acceptance, and timed out during repair.
- Raw sanitized rerun evidence is preserved at `docs/evals/m15-kimi-coding-ab-rerun-2.json`; interpretation is recorded in `docs/evals/M15_KIMI_CODING_AB_RERUN_2_ANALYSIS.md`. No M10 verification, pack population, activation, public benchmark claim, or AGI/model-superiority claim follows from either incomplete run.
- Review found a measurement-design defect: v1 used the same 180000 ms value for provider timeout and candidate latency acceptance, making a slow arm unmeasurable at the latency boundary. Offline hardening separates measurement timeout from acceptance in a versioned runtime-owned profile.
- Verified profile `m15-kimi-coding-ab-v2`: acceptance latency 180000 ms, provider measurement timeout 240000 ms, minimum 30000 ms headroom, 2 calls per arm, 12 total calls, `high` reasoning, temperature 1. Evidence identity includes the profile version and sanitized output exposes bounded profile metadata.
- One-shot hardening run `33882837781` passed **329/329 tests**, Biome, strict TypeScript, build, secret-free Kimi dry smoke, and a credential-free A/B dry profile; aggregate coverage **89.92% lines / 77.25% branches / 95.88% functions**. No live provider request occurred in this hardening run.
- The previous authorization for one second Kimi live rerun has been consumed. A third live provider comparison requires new explicit user authorization. PR merge also remains separately approval-gated.
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

## M15 post-merge evidence and repair plan

1. Preserve the raw authorized run `33870210502` unchanged and classify its result correctly from recorded evidence: zero complete matched pairs means `INCONCLUSIVE`.
2. Harden future live evidence so incomplete arms cannot produce a false numeric zero-lift conclusion; emit only bounded non-secret diagnostic codes for failures.
3. Keep the hardening behind normal PR `npm run verify`; helper verification is supporting evidence, never a substitute for exact-head PR CI.
4. Keep ROADMAP/ARCHITECTURE/SECURITY/M15 milestone/HANDOVER synchronized with the observed run and its inconclusive interpretation.
5. Do not promote or activate `odin-coding-discipline` from incomplete evidence.
6. User approval now permits exactly one corrected rerun after PR #21 merges. Use the same NVIDIA `moonshotai/kimi-k3`, same coding task class, same matched baseline/candidate protocol, existing secret boundary, and configured provider-call ceiling. Preserve the new result separately and classify it only from complete matched evidence.
7. Use the same matched A/B protocol for other provider/model identities later only under separately authorized live-provider scope. Architectural reliability gains may transfer across models; measured lift magnitude must be re-established per model/profile/task class.

## Standing boundaries

- Repository evidence overrides documentation and memory; CI green is required before merge.
- M3 remains execution/capability authority; M5 remains completion/evidence authority; M10 remains skill promotion authority; M11 quality floors remain monotonic.
- Models/workers/skills/replay cannot mint credentials, capabilities, approval, budgets, quality evidence, trusted policy, or lifecycle promotion.
- External skills are discovery/candidate inputs only; Odin-owned distilled procedures must still pass M15 held-out evaluation before trusted registration/use.
- No secrets in commits/logs/artifacts. The current live approval covers one bounded Kimi K3 rerun only.