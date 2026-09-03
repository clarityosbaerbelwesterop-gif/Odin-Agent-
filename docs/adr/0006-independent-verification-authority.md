# ADR-0006: Independent verification authority

- Status: accepted
- Date: 2026-09-03

## Context

A green tool result or a planner/runtime assertion is necessary evidence, but neither is sufficient
authority to declare a mission complete. The M4 slice could previously advance from its own quality
check to completion without a separately validated mapping from every definition of done to evidence.

## Decision

Odin uses a deterministic `VerificationAuthority` between execution and task/mission completion. It
validates bounded typed claims, evidence, and bindings for identity, mission/task scope, kind,
provenance, canonical time, freshness, content hash, and status. A separate adversarial reviewer tries
to falsify a provisional pass and may return `ACCEPT`, `BLOCK`, or `REPAIR_REQUIRED`. Reviewer output
is validated and hash-checked before it is trusted. Only a consistent verifier `PASS`, reviewer
`ACCEPT`, and aggregate `PASS` permits M4 to mark tasks verified and enter checkpoint/final audit.

## Alternatives

- Trust the quality command directly: simpler, but it cannot prove evidence-to-claim coverage or
  detect stale, foreign, contradictory, or self-authored evidence.
- Use a model judge first: flexible, but nondeterministic, costly, and vulnerable to prompt injection
  without the deterministic evidence contract this decision establishes.
- Put verification inside the coding orchestrator: fewer types, but combines producer and judge and
  prevents independent testing or later verifier substitution.

## Consequences

Coding completion now requires an injected verifier and one fresh scoped post-change read. This costs
an additional bounded read/tool attempt and adds explicit blocked outcomes, but removes self-certified
completion. Repair requests remain data only; later controllers may collect evidence and retry, while
M5 itself cannot mutate repositories, mission state, policy, or tools.

## Security impact

Evidence and reviewer output are untrusted inputs. Size limits, canonical timestamps, allowlists,
scope checks, deterministic hashes, and fail-closed malformed-output handling reduce confused-deputy,
replay, stale-evidence, and false-positive completion risks. No raw tool output or chain of thought is
stored in verdict metadata.

## Verification

M5 tests cover valid pass, missing/stale/foreign/failed/conflicting/duplicated evidence, cross-task
reuse, weak or self-authored provenance, malformed reviewer results, bounded repair, deterministic
replay, and M4 completion denial after an otherwise green quality command.
