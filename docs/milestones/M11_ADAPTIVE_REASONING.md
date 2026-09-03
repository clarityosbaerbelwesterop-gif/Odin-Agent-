# M11 — Adaptive reasoning, routing, and efficiency

Status: VERIFIED. Updated: 2026-09-03.

## Objective

Make Odin choose model/effort/reasoning strategy from measured evidence rather than static preference,
while preserving a hard quality floor and bounded cost. M11 adds deterministic empirical routing,
escalation, bounded critique/self-correction, finite branch search, and explicit cache/concurrency
policy. It does not allow a model to raise its own trust, quality score, budget, or verification status.

This milestone is the adaptive-reasoning portion of the capability-amplification path. It is intended
to let smaller/faster models handle work they can demonstrably perform and escalate only when quality,
risk, uncertainty, or independent evidence requires more capability.

## Invariants

1. **Quality before cost:** no cost/latency optimization may select a route below the effective quality floor.
2. **Empirical evidence:** routing scores come from bounded, hash-addressed evaluation records, not model self-report.
3. **Capability first:** unsupported image/tool/structured-output/context requirements eliminate a model before scoring.
4. **Freshness:** stale or malformed evaluation evidence cannot silently route production work.
5. **Bounded reasoning:** branches, critique passes, repair attempts, model calls, parallel calls, estimated cost, and estimated tokens have runtime-owned ceilings.
6. **Independent acceptance:** self-confidence, critique text, or majority vote never substitutes for M5 evidence.
7. **Determinism:** equivalent normalized profiles/evaluations/requests produce the same route and decision hash.
8. **No authority expansion:** M11 chooses strategy only; it cannot mint M3 capabilities, M5 evidence, M7 ownership, M10 skill promotion, or credentials.

## Core contracts

### Empirical evaluation record

Each record binds:

- provider/model/profile version;
- exact reasoning effort when the model exposes controllable effort;
- task class;
- sample count and integer quality/pass scores;
- observed latency and token metrics;
- evaluation timestamp, producer class/reference, and SHA-256 content identity.

Only allowlisted independent/project evaluation producers are routing evidence. Runtime/model/worker
self-evaluations are rejected for quality-floor decisions. Future, stale, conflicting, malformed, or
hash-tampered evidence fails closed.

### Route request

A route request defines:

- stable mission/task identity and task class;
- required model capabilities and minimum context/output requirements;
- risk and uncertainty classes;
- base quality floor;
- estimated input/output tokens;
- maximum estimated cost and maximum estimated tokens;
- model calls, parallel calls, branches, critique passes, and repairs;
- cache freshness/sensitivity policy.

The runtime derives an **effective quality floor** from the base floor plus bounded risk/uncertainty
uplift. Callers cannot lower the configured safety floor through negative or malformed values.

`maxEstimatedTokens` is an explicit hard reasoning ceiling. The plan derives a token-based model-call
ceiling from estimated input plus output tokens per call and takes the minimum with the configured call
ceiling. If one estimated call cannot fit, routing fails with `BUDGET_EXCEEDED` before execution.

### Route decision

A successful route decision contains:

- primary provider/model/profile version;
- chosen supported reasoning effort when applicable;
- estimated cost and observed empirical quality/latency;
- ordered escalation candidates that meet the same floor;
- bounded reasoning policy: branch count, critique passes, repair ceiling, parallelism, per-call token estimate, total token ceiling, and effective model-call ceiling;
- cache eligibility/key/freshness policy;
- explicit reasons and a deterministic decision hash.

If no candidate satisfies capabilities, fresh empirical evidence, quality floor, or budget, routing
fails closed with typed reasons. It must never quietly downgrade quality.

## Bounded reasoning controller

The controller consumes runtime-owned attempt state plus independent verification/evidence signals and
returns only one next action:

- `ACCEPT` — only after independent pass evidence;
- `CRITIQUE` — bounded review pass while critique budget remains;
- `REPAIR` — targeted correction while repair budget remains;
- `ESCALATE` — move to a stronger eligible route after uncertainty/failure or exhausted local repair;
- `BLOCK` — no safe action remains within quality/budget bounds.

Branch search is finite and deterministic. Branches are proposal paths, not completion authorities.
A branch can be selected for continuation only after its evidence state is accepted by the controller;
majority vote or model confidence alone cannot make it final.

For bounded high-risk plans, M11 reserves repair capacity before consuming every remaining model call
on additional critique. That preserves targeted repair-before-escalation semantics without increasing
the configured call or token ceilings.

## Cache and concurrency policy

M11 may reuse a route/model result only when the cache key binds the normalized request, model/profile,
reasoning policy, relevant context/evidence identity, and freshness policy. Sensitive or explicitly
non-cacheable work never enters response cache. Cache hits do not bypass M5 verification or evidence
freshness.

Parallelism is bounded by the minimum of request ceiling, eligible branch count, and effective
model-call budget. The effective model-call budget is itself capped by the explicit token ceiling.

## Required regressions

- cheapest eligible model wins only after the quality floor is satisfied;
- stronger model wins when the cheap model is below floor;
- no model below floor is selected when all candidates are insufficient;
- capability mismatches eliminate candidates before scoring;
- stale, future, malformed, duplicate, self-authored, or hash-tampered evaluation records fail closed;
- evaluation evidence is bound to exact provider/model/profile version and reasoning effort;
- risk/uncertainty can raise the effective floor but never lower configured minimums;
- deterministic candidate ordering and route hash survive input reordering;
- estimated cost ceiling blocks or forces a different eligible route without lowering quality;
- explicit estimated-token ceiling reduces the permitted model-call count and blocks when one call cannot fit;
- critique/branch/repair/call/parallel ceilings cannot be exceeded;
- bounded plans preserve a repair opportunity before escalation when configured budget permits it;
- independent PASS can accept, verification failure can repair/escalate, and self-confidence cannot accept;
- cache key changes when model/profile/context/evidence/reasoning policy changes;
- sensitive or stale-cache work is not cacheable;
- offline eval fixture compares small/fast and stronger profiles without live provider calls.

## Verification evidence

GitHub Actions helper verification run `33784031658` passed on the implementation that became clean
branch head `c70bf2eede8892ba34380d104cd73cefd9aacd2a` with **199 tests, 199 passes, 0 failures**.
Aggregate coverage was **90.01% lines, 76.94% branches, and 95.63% functions**. Foundation validation,
Biome, strict TypeScript, and the complete test suite all passed. `src/routing/reasoning.ts` reached
94.24% line coverage and 86.67% branch coverage.

The earlier normal PR run `33782424402` proved the pre-token-ceiling M11 core with 198/198 tests. The
later acceptance review found the missing explicit token ceiling before merge; the requirement was
implemented and exposed a repair-budget ordering defect, which was fixed by reserving repair capacity
before additional critique. No gate was weakened.

Normal pull-request CI run `33784322602` passed after the human-authored implementation-evidence
checkpoint. Fully synchronized Roadmap/Architecture/Security/Handover state then passed normal PR CI
run `33784732544`. These runs verify the clean branch without relying on the temporary helper workflow.

## Out of scope

- live-provider benchmark spend or production traffic experiments;
- hidden chain-of-thought capture or persistence;
- unbounded Tree-of-Thoughts/MCTS;
- model-created quality scores used as independent evidence;
- production Redis/distributed response cache;
- production scheduler/daemon, MCP, browser automation, deployment, or paid resources;
- M12 process/container/worktree sandbox and live-provider release matrix.

M11 is `VERIFIED`: implementation, requirement-derived regressions, synchronized architecture/security/
roadmap/handover, and normal pull-request CI have passed. Production/live-provider claims remain out of
scope until separately authorized and exercised.
