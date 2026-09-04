# M15 Kimi K3 coding A/B — rerun 3 / v2 analysis

Updated: 2026-09-04.

## Scope

This note interprets the third explicitly authorized live comparison only. The raw sanitized evidence is preserved unchanged at `docs/evals/m15-kimi-coding-ab-rerun-3-v2.json` and remains the historical record of what the runner emitted at the time.

Run `33884808665` used NVIDIA `moonshotai/kimi-k3` with runtime-owned profile `m15-kimi-coding-ab-v2`: `high` reasoning, 180000 ms acceptance latency, 240000 ms provider measurement timeout, two calls per arm/case, and a 12-call global ceiling shared by `generate()` and `stream()`. Repository verification, build, and credential-free dry-run all passed before the first live provider request. The live workflow used 10 provider calls and completed successfully at the workflow level.

The baseline arm is **Kimi K3 + Odin core runtime**. The candidate arm is **the same Kimi K3 + the same Odin runtime + evaluation-only `odin-coding-discipline@m15v1` guidance**. This experiment therefore measures only the additive candidate procedure on these three fixtures. It is not a raw Kimi benchmark and it is not a comparison against GPT-6 Astra or Claude Fable 5.1.

## Raw live outcomes

| Case | Baseline | Candidate | Calls | Mutation |
| --- | --- | --- | --- | --- |
| `canonical-user-id` | `quality_failed_after_repair`, quality 0 | ambiguous `provider_malformed_response`, quality 0 | 2 / 1 | yes / no |
| `retry-429-surgical` | `quality_failed_after_repair`, quality 0 | `plan_expected_sha_mismatch`, quality 0 | 2 / 1 | yes / no |
| `safe-trim-existing-api` | `quality_failed_after_repair`, quality 0 | `repair_no_change`, quality 0 | 2 / 2 | yes / yes |

The raw artifact reports `INCONCLUSIVE` with zero complete pairs because the runner version used during the live call set `measurementComplete=false` for every thrown error, including deterministic terminal task failures.

## Post-run evidence-semantics defect

Review after the live run found that the wrapper conflated two different conditions:

1. **interrupted or ambiguous measurement** — for example timeout, network failure, authentication/rate-limit failure, or an ambiguous malformed provider response; and
2. **bounded terminal task outcome** — for example a stale/wrong expected SHA in the model plan, a no-change repair, a quality gate still failing after the one bounded repair, verification denial, or a deterministic runtime budget/context limit.

The first class must remain incomplete because the task outcome is not known. The second class is valid negative evidence and must remain measurable; otherwise a candidate can disappear from scoring precisely when it fails deterministically.

The repaired runtime uses an explicit allowlist of terminal measured failure codes. Provider `malformed_response` remains **incomplete**, not terminal, because the normalized category can represent transport-level invalid/oversized JSON as well as other response-shape failures and is therefore not sufficiently specific to attribute to task quality. Failed arms keep the conservative 10,000,000-token sentinel so a failure cannot accidentally pass M15 token or authority gates merely because usage was not available.

## Defensible reinterpretation

With the verified semantics applied to the already-preserved diagnostics, the third run is:

- **status: PARTIAL**;
- **2 / 3 matched pairs complete**;
- **1 / 3 pair incomplete** (`canonical-user-id`, candidate `provider_malformed_response`);
- on the two complete pairs, baseline quality = **0**, candidate quality = **0**, measured lift = **0 bps**.

This is negative evidence for `odin-coding-discipline@m15v1`: it demonstrates **no measured improvement** on the two unambiguous matched pairs. It does not satisfy M15 promotion criteria. The candidate remains unverified/unactivated from this live evidence and no capability pack may treat it as a measured winner.

It is equally important that all three baseline arms failed. The result therefore points to a more fundamental live Kimi/Odin coding-path reliability problem before candidate-skill optimization can be meaningful.

## Offline control result

To separate fixture/runtime validity from live model behavior, PR #23 adds a deterministic control for the exact three live fixture patterns. Each control uses a `ScriptedProvider` that returns one correct structured plan while retaining the same Odin M4 repository tool path, quality command, mission runtime, and M5 independent verification path.

Normal PR CI run `33888060837` passed **336/336 tests**. All three controls completed first pass, passed their deterministic quality command, and reached M5 PASS with one provider response each. Biome, strict TypeScript, the full repository test suite, and the credential-free Kimi dry smoke also passed. Aggregate coverage was **89.99% lines / 77.41% branches / 95.89% functions**.

This control demonstrates that the three fixtures are solvable through the current Odin M4/M5 harness when a valid structured plan is supplied. It does **not** prove that every aspect of the live NVIDIA adapter or prompt contract is optimal. The remaining investigation should therefore focus on the live model/provider interaction and model-produced plan/repair quality rather than weakening fixture acceptance or M5.

## Governance verification

Governance synchronization run `33888434077` applied the rerun-3 interpretation to `HANDOVER.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `SECURITY.md`, and the M15 milestone document, then passed `npm run verify` with **336/336 tests**, Biome, strict TypeScript, and the credential-free Kimi dry smoke before committing the synchronized documents. The helper workflow and helper script removed themselves. No live provider call occurred in that synchronization run.

## Engineering conclusions

1. v2 improved observability: the experiment progressed past the v1 timeout-dominated state and exposed deterministic plan/repair/quality failures.
2. `odin-coding-discipline@m15v1` is **not a measured winner**. No verification, activation, or pack inclusion is justified.
3. The baseline itself is not reliable enough on these three tiny coding tasks. Improving or diagnosing the live structured-output / plan / repair protocol has higher priority than adding more skill text.
4. The raw artifact must remain immutable. Reinterpretation is a separate derived analysis, not a rewrite of historical evidence.
5. A future live comparison must use a new explicit authorization and a new immutable evidence file. Numeric lift cannot be transferred to other models; the same method must be repeated for each provider/model/profile/task class.

## Claim boundary

This experiment does not establish a public Kimi K3 benchmark score, model-wide regression, Odin-vs-Kimi improvement percentage, AGI/ASI capability, or superiority/equivalence to GPT-6 Astra or Claude Fable 5.1. It is a three-case, task-specific integration experiment whose current usable result is partial negative evidence for one candidate procedure and a concrete live coding-path reliability signal.
