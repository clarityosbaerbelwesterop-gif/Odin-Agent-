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
- One-shot profile hardening run `33882837781` passed **329/329 tests**, Biome, strict TypeScript, build, secret-free Kimi dry smoke, and a credential-free A/B dry profile; aggregate coverage **89.92% lines / 77.25% branches / 95.88% functions**. No live provider request occurred in this hardening run.
- Adversarial diff review found that the A/B wrapper charged `generate()` but not `stream()` against the total provider-call budget. Run `33883857442` verified a shared fail-closed call counter for both paths with **331/331 tests**, aggregate coverage **89.95% lines / 77.30% branches / 95.89% functions**, `live-profile` coverage **96.97% / 95.83% / 100%**, build, and credential-free A/B dry-run PASS. No live provider request occurred.
- The automatic exact-head CI created by the bot-authored hardening commit was `action_required` with no jobs, so this factual handover checkpoint is intentionally user-authored to trigger the required normal PR CI rather than treating helper CI as a substitute.
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

## M15 current evidence and next gate

1. Preserve both raw live attempts unchanged. Run `33870210502` and rerun `33879714040` each have zero complete matched pairs and remain `INCONCLUSIVE`.
2. Keep `odin-coding-discipline` unverified/unactivated from live evidence until a complete matched comparison passes normal M15 quality, safety, authority, token, and latency gates.
3. Keep execution-profile identity part of future evidence; v1 incomplete results must not be numerically combined with v2 results.
4. Use `m15-kimi-coding-ab-v2` for any future explicitly authorized Kimi comparison: 180000 ms acceptance, 240000 ms measurement timeout, `high` reasoning, 12-call hard ceiling shared by generate/stream.
5. Obtain a normal exact-head PR `npm run verify` on the current user-authored head. Helper runs are supporting evidence, not a merge substitute.
6. Do not merge the current PR without explicit merge authorization.
7. Do not issue a third live provider request without new explicit user authorization. If approved later, preserve the result separately and classify it only from complete matched evidence.
8. Re-establish measured lift separately for every provider/model/profile/task class; architectural reliability mechanisms may transfer, numeric lift does not.

## Standing boundaries

- Repository evidence overrides documentation and memory; CI green is required before merge.
- M3 remains execution/capability authority; M5 remains completion/evidence authority; M10 remains skill promotion authority; M11 quality floors remain monotonic.
- Models/workers/skills/replay cannot mint credentials, capabilities, approval, budgets, quality evidence, trusted policy, or lifecycle promotion.
- External skills are discovery/candidate inputs only; Odin-owned distilled procedures must still pass M15 held-out evaluation before trusted registration/use.
- No secrets in commits/logs/artifacts. The consumed rerun authorization does not cover another live provider action.

## M15 rerun-3 v2 evidence update — 2026-09-04

Third authorized NVIDIA/Kimi K3 live run `33884808665` completed under `m15-kimi-coding-ab-v2` after repository verify, build, and credential-free dry-run gates passed. It used 10/12 maximum provider calls. The immutable raw artifact remains `docs/evals/m15-kimi-coding-ab-rerun-3-v2.json` and its separate interpretation is `docs/evals/M15_KIMI_CODING_AB_RERUN_3_V2_ANALYSIS.md`.

Post-run review found that the old wrapper marked every thrown task failure incomplete. The hardened semantics distinguish ambiguous/infrastructure interruption from deterministic terminal task failure. Applied conservatively to the preserved diagnostics, rerun 3 is **PARTIAL**: two matched pairs are complete terminal failures at quality 0 vs 0 / lift 0, while `canonical-user-id` stays incomplete because the candidate ended in ambiguous `provider_malformed_response`. No M10 verification, activation, capability-pack inclusion, public benchmark claim, or AGI/Astra/Fable claim follows.

An offline exact-fixture control proves the three coding fixtures themselves are solvable through the same Odin M4 repository/quality path and M5 completion authority when supplied one valid structured plan. Normal PR CI `33888060837` passed 336/336 tests, Biome, strict TypeScript, and secret-free Kimi dry smoke; aggregate coverage was 89.99% lines / 77.41% branches / 95.89% functions. This shifts the next engineering priority toward live Kimi/provider structured-output and plan/repair reliability, not weaker quality gates or more candidate prompt text. PR #23 remains merge-approval-gated and no fourth live provider run is authorized.
