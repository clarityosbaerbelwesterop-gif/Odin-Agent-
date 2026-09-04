# M16 Kimi K3 grounded output run 4 analysis

Updated: 2026-09-04.

## Scope

Run `33896223881` is the fourth explicitly authorized NVIDIA `moonshotai/kimi-k3` live evaluation. It compares the legacy M4 coding contract with the same model/runtime wrapped by `GroundedCodingProvider`. Repository verification, build, and credential-free dry-run passed before provider access. The run consumed 11/12 maximum provider calls and preserved sanitized evidence at `docs/evals/m16-kimi-grounded-output-run-4.json`.

## Measured result

The historical run-4 artifact is **PARTIAL**: two of three matched pairs were complete under the classifier that existed during the run. On those two complete pairs, both paths remained at quality 0, so no completion or quality uplift is proven. The grounded path did, however, use **2,196** total tokens versus **3,916** for legacy, a measured **43.92% token reduction**, and **174,981 ms** versus **277,968 ms** aggregate latency, a measured **37.05% latency reduction**. Provider-call count worsened from 3 to 4 on that matched subset.

These reductions are task- and profile-specific. They are not model-wide benchmarks and do not transfer numerically to GPT-6 Astra, Claude Fable 5.1, GLM, or another provider/profile.

## Run-4 defect found before run 5

The incomplete `canonical-user-id` grounded arm made two successful metered provider calls, mutated the target, and then ended as `MissionDomainError / mission_domain_unknown`. Review found that M16 introduced new deterministic grounded-contract errors but the live-evidence classifier still knew only legacy M4 error messages. A grounded schema/content/path/quality-command failure could therefore become `mission_domain_unknown` and disappear from matched scoring even though the provider calls completed.

The hardening tranche adds bounded codes for model-output-side grounded plan/repair contract failures and treats those codes as terminal measured outcomes. Runtime request-binding failures remain unknown/incomplete instead of being mislabeled as model quality. Grounded schema-validation failures are normalized into bounded MissionDomain errors rather than leaking validator detail.

The strength evaluator is also extended with secret-safe telemetry: normalized finish-reason counts, cached/reasoning token subtotals where the provider supplies them, and boolean deterministic acceptance/exact-output signals. Raw model text and repository content remain absent from evidence.

## Claim boundary

Run 4 proves a substantial token/latency efficiency signal on two matched failing cases, not a quality win. No Odin-vs-Astra/Fable intelligence-superiority claim follows. Run 5 must execute only after this diagnostic hardening passes normal CI and is merged.
