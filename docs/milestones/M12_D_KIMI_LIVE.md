# M12-D — Kimi K3 live provider evidence

Status: **LIVE_PROVIDER_VERIFIED** for one bounded NVIDIA/Kimi K3 coding mission. Full M12 remains
`PARTIALLY_VERIFIED` because hosted-sandbox, broader live matrix, and public-production proof are still
open. Updated: 2026-09-04.

## Objective

Exercise one deliberately bounded end-to-end Odin coding mission through the real NVIDIA provider
adapter using repository secret `NV_API_KEY` and model `moonshotai/kimi-k3`.

This is an evidence escalation from M12-C `local` proof to one real live-provider compatibility result.
It is not a production deployment, hosted-sandbox test, broad benchmark, model-leaderboard claim, or
AGI proof.

## Exact task

The live mission used Odin's existing isolated in-memory M4 fixture. The target file initially contained
an incorrect `add(a, b)` implementation. Odin had to:

1. discover bounded repository evidence through M3 tools;
2. obtain a strict structured coding plan through the M1 NVIDIA/Kimi provider boundary;
3. create and advance an M2 mission;
4. patch only the scoped target through M3 capability policy;
5. execute the registered deterministic `verify` quality gate;
6. use at most one bounded repair call if the first patch failed;
7. require M5 independent verification;
8. reach `COMPLETED` with the correct addition implementation.

## Provider and secret boundary

- exact provider/model identity: `nvidia` / `moonshotai/kimi-k3`;
- provider endpoint owned by `NvidiaProvider`: `https://integrate.api.nvidia.com/v1`;
- request configuration: `temperature: 1`, `reasoning_effort: max`;
- maximum provider calls: **2**;
- raw `NV_API_KEY` existed only in the GitHub Actions control-plane environment;
- credential resolution was restricted to the exact authorized provider/model identity;
- the secret was not placed in model messages, fixture files, result JSON, logs, commits, or artifacts;
- no model reasoning content was persisted in the evidence artifact.

## Verified live result

GitHub Actions live run **`33837291528`** completed successfully on head
`8965a1252be12c6da5df485804c4b1580394be96`.

Sanitized artifact `m12d-kimi-k3-live-result`:

- completed: **true**;
- deterministic score: **100 / 100**;
- first pass: **true**;
- repair required: **false**;
- provider calls: **1** of maximum 2;
- latency: **22,400 ms**;
- model usage: **632 input tokens / 222 output tokens**;
- Odin attempts: **8**;
- Odin tool calls: **7**;
- final quality command: `verify`, exit code **0**;
- M5 verification outcome: **PASS**;
- verification result hash:
  `98bd0b921fd446ca46254a55575222e1147da8982f7e39b16422f51125440fe6`;
- final target content:
  `export function add(a: number, b: number): number { return a + b; }`;
- artifact digest:
  `sha256:1f919a3a42a568fd1688c78331ed3998388b8a9bfec48fbb7501e072b65588b2`.

The workflow was converted to `workflow_dispatch` immediately after the successful evidence run, so
future live calls require an explicit manual trigger instead of another branch push.

## What this proves

This proves that the current Odin M1/M2/M3/M4/M5 path can use the real NVIDIA Kimi K3 endpoint and
complete one bounded coding mission under strict planning, scoped tools, deterministic quality, budgets,
secret-safe credential resolution, and independent verification.

The first-pass result is useful evidence for the project's capability-amplification thesis: the model
needed only one provider call while the runtime supplied repository discovery, execution authority,
quality enforcement, and verification around it.

## What this does not prove

This single task does **not** prove that Kimi K3 + Odin is stronger than GPT-6 Astra, Fable 5.1, or any
other model/system. A superiority claim requires the same hidden/unseen task set, comparable tool/runtime
conditions, repeated trials, identical scoring, and authorized access to the baseline systems.

It also does not establish AGI. It is evidence that Odin's architecture can amplify and constrain a
capable live model on one coding task. A credible 'bridge to AGI' evaluation requires broad unseen task
families, transfer, long-horizon recovery, tool learning, memory, multi-agent work, adversarial safety,
and repeated comparisons against stronger baselines.

## Verification chain

- secret-free preparation CI `33837231690`: success with 258/258 tests plus `smoke:kimi:dry`;
- real live provider run `33837291528`: success with the sanitized 100/100 result above;
- one-shot evidence documentation sync `33837694908`: success; helper removed in the same bot commit;
- synchronized evidence head before final normal CI: `4e773df58eda9ccf36103336157412b94524e7c2`;
- this human-authored commit exists only to trigger the final normal PR verification on the synchronized,
  manual-only workflow state. No live provider call is triggered by it.

## Remaining M12 proof

- hosted sandbox live smoke and cleanup evidence;
- broader live-provider evaluation matrix if separately authorized;
- public-service authentication/realtime transport;
- deployment/production hardening and production recovery evidence.

## Out of scope without separate authorization

- hosted sandbox or paid infrastructure creation;
- public deployment/auth/realtime traffic;
- production data or customer repositories;
- billing changes;
- repeated live benchmark sweeps;
- GPT/Fable comparison runs without separately authorized comparable access.
