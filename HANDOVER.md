# Engineering handover

Updated: 2026-09-04.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` contains verified M0–M15 at merge commit `30bcab22f6129925b704fff0d024ca40e472b06c`.
- Active work: PR #21 on `agent/m15-kimi-postmerge-evidence`, preserving and interpreting the authorized post-merge Kimi K3 A/B evidence and hardening future live-comparison diagnostics.
- Authorized post-merge live run `33870210502` completed its workflow with **10/12** maximum provider calls across three matched coding cases. All six baseline/candidate arms recorded `measurementComplete=false`, so there are **0 complete matched pairs** and the result is **INCONCLUSIVE**, not measured zero lift.
- Raw sanitized evidence remains in `docs/evals/m15-kimi-coding-ab.json` at commit `42f9f28`; interpretation is recorded separately in `docs/evals/M15_KIMI_CODING_AB_ANALYSIS.md` so the historical evidence is not rewritten after the fact.
- No M15 coding candidate is promoted or activated from that run. No Kimi/Astra/Fable/AGI capability claim follows from incomplete task-specific evidence.
- PR #21 adds deterministic `MEASURED`/`PARTIAL`/`INCONCLUSIVE` summary semantics plus bounded secret-safe live failure codes. Helper run `33878406947` passed **325/325 tests**, Biome, strict TypeScript, secret-free Kimi dry smoke, and **89.87% / 77.08% / 95.87%** aggregate line/branch/function coverage. Exact-head normal PR CI `33878909210` passed on `382e44d4170c5e2c3c74b922172dc6e366d26caa` before this documentation-only authorization checkpoint.
- The user explicitly authorized **merging PR #21 and running one second bounded NVIDIA/Kimi K3 matched A/B comparison** on 2026-09-04. The rerun must use the corrected harness, same provider/model/task-class identity, the existing `NV_API_KEY` GitHub Actions secret boundary, and the existing 12-call hard ceiling. This approval does not authorize broader benchmark sweeps, paid hosted sandboxes, production deployment, or candidate activation.
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