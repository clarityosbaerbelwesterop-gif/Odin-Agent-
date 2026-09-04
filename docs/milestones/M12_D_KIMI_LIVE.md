# M12-D — Kimi K3 live provider evidence

Status: PREPARED; live provider call not yet executed. Updated: 2026-09-04.

## Objective

Exercise one deliberately bounded end-to-end Odin coding mission through the real NVIDIA provider
adapter using repository secret `NV_API_KEY` and model `moonshotai/kimi-k3`.

This is an evidence escalation from M12-C `local` proof toward live-provider compatibility. It is not a
production deployment, hosted-sandbox test, broad benchmark, model-leaderboard claim, or AGI proof.

## Exact task

The live mission uses Odin's existing isolated in-memory M4 fixture. The target file initially contains
an incorrect `add(a, b)` implementation. Odin must:

1. discover bounded repository evidence through M3 tools;
2. obtain a strict structured coding plan through the M1 NVIDIA/Kimi provider boundary;
3. create and advance an M2 mission;
4. patch only the scoped target through M3 capability policy;
5. execute the registered deterministic `verify` quality gate;
6. if the first patch fails, use at most one bounded model repair call;
7. rerun quality and require M5 independent verification;
8. reach `COMPLETED` with `return a + b;` in the fixture target.

## Provider and secret boundary

- exact provider/model identity: `nvidia` / `moonshotai/kimi-k3`;
- endpoint remains owned by `NvidiaProvider`: `https://integrate.api.nvidia.com/v1`;
- Kimi request configuration uses `temperature: 1` and `reasoning_effort: max`;
- maximum provider calls for the smoke mission: **2**;
- raw `NV_API_KEY` is read only by the GitHub Actions control-plane process;
- the credential resolver releases it only for the exact authorized provider/model identity;
- the secret is never placed in model messages, fixture files, result JSON, logs, commits, or artifacts;
- no model reasoning content is persisted by the smoke result.

## Result contract

The sanitized result may contain only bounded non-secret evidence such as:

- provider/model identity;
- completion state;
- provider-call count;
- latency;
- input/output token usage;
- first-pass vs repaired status;
- final fixture source text;
- deterministic quality result;
- M5 verification outcome/hash;
- tool/attempt counts;
- deterministic 0–100 smoke score.

A score of 100 means the bounded fixture completed first-pass with deterministic quality and verification.
A repaired success can score 95. Any lower score or non-completion fails the live smoke workflow.

## Comparison discipline

This single task cannot prove that Kimi K3 + Odin is stronger than GPT-6 Astra, Fable 5.1, or any other
model/system. A superiority claim requires the same hidden/unseen task set, comparable tool/runtime
conditions, repeated trials, identical scoring, and authorized access to the baseline systems.

The run can still provide useful evidence about Odin's capability-amplification architecture: whether a
real model can be constrained by strict planning, tools, verification, repair, budgets, and secret-safe
provider boundaries while completing a task. That is relevant to the project's 'bridge to AGI' research
question, but it is not evidence of AGI itself.

## Acceptance gates before live execution

- normal PR `npm run verify` passes;
- `smoke:kimi:dry` successfully imports the compiled runtime without reading a secret or making network calls;
- live workflow is one-shot/bounded and never echoes the key;
- result artifact contains only the sanitized contract above.

## Out of scope

- hosted sandbox provider execution;
- public deployment/auth/realtime traffic;
- production data or customer repositories;
- paid resource creation or billing changes;
- repeated benchmark sweeps;
- GPT/Fable comparison runs without separately authorized comparable access.
