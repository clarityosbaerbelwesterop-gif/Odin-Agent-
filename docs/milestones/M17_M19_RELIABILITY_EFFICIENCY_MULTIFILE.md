# M17–M19 — Reliability, context efficiency, and multi-file coding

Status: **IN PROGRESS**. This document is the delivery contract for one pull request containing three
sequentially verified milestones. A checked item requires repository evidence; intent is never marked
complete.

## Package objective

Raise Odin's verified coding reliability without weakening M3 execution authority, M5 completion
authority, M6 context precedence, M11 quality floors, or M12 sandbox boundaries. The package forms one
vertical capability:

1. M17 classifies failures and selects a bounded recovery action.
2. M18 compiles the smallest evidence-preserving context for that action.
3. M19 applies coordinated multi-file changes transactionally and can restore trusted preimages.

The model may propose diagnoses, plans, edits, or repairs. Runtime-owned policy validates and executes
them. Model confidence is not verification evidence.

## Invariants

- Repository state and fresh trusted evidence outrank memory and model output.
- Only independent M5 evidence can authorize completion.
- Retry, escalation, token, call, runtime, and file-count ceilings are explicit and fail closed.
- Unknown or non-idempotent side effects are never retried blindly.
- Failure records are structured, bounded, secret-safe, serializable, and hash-addressed; raw exception
  text and hidden reasoning are not canonical state.
- Context reduction cannot remove P0–P2 inputs or evidence required by the current verification method.
- Multi-file writes require canonical paths, exact preimage hashes, conflict-free ownership, and a
  recoverable staged change set before commit.
- A rollback claim requires runtime-attested restoration plus fresh verification.
- No milestone creates credentials, permissions, provider capabilities, tool grants, or external side
  effects.

## M17 — Reliability engine

Goal: replace ad-hoc retries with deterministic failure classification and evidence-bound recovery.

- [ ] Normalize provider, tool, planning, execution, verification, persistence, sandbox, budget, policy,
  and cancellation failures into bounded categories.
- [ ] Select targeted retry, context reduction, alternate planning, rollback, verifier/model escalation,
  checkpoint-and-block, or cancellation stop from typed evidence and remaining budgets.
- [ ] Track failure signatures, attempted strategies, and outcomes so repeated no-progress strategies
  cannot loop indefinitely.
- [ ] Deny retry after unknown/non-idempotent external effects; require explicit rollback evidence before
  continuing after reversible writes.
- [ ] Integrate the controller into the coding path instead of leaving it as an isolated helper.
- [ ] Cover timeout, rate limit, malformed output, context overflow, invalid plan, quality failure,
  contradictory verification, budget exhaustion, cancellation, tampering, and repeated-failure tests.

Exit gate: deterministic recovery decisions survive serialization/replay; at least one coding-path
integration test proves a classified failure reaches the permitted next action; all repository gates pass.

## M18 — Token efficiency 2.0

Goal: reduce unnecessary model context and output while preserving the same acceptance requirements.

- [ ] Compile context deltas from stable prefix identity, current task inputs, source hashes, prior
  observations, and M6 priority rules.
- [ ] Add source-bound semantic cache entries that invalidate on content, scope, policy, model profile,
  or verification-requirement changes.
- [ ] Compact tool results into bounded typed summaries while retaining hashes/references to full evidence.
- [ ] Stop reasoning early only when the required independent evidence already satisfies the task's
  definition of done.
- [ ] Select reasoning depth from task risk, ambiguity, failure history, and remaining budget through M11.
- [ ] Add an offline paired evaluation that reports estimated-token deltas and acceptance parity; record
  measured fixture results without generalizing them to all tasks or providers.

Exit gate: a deterministic held-out fixture suite demonstrates at least 50% fewer estimated context tokens
than its declared baseline with identical verifier outcomes, and all cache/staleness/security regressions
pass. This is a fixture-bound result, not a universal savings claim.

## M19 — Multi-file coding

Goal: support real repository-wide changes across 10–100 files with dependency-aware coordination and
recoverable application.

- [ ] Represent a bounded change set as a DAG with canonical paths, dependencies, ownership, operation,
  exact preimage hash, proposed postimage hash, and verification method.
- [ ] Reject cycles, duplicate ownership, path overlap, stale preimages, symlink/path escape, forbidden
  files, and more than 100 target files before mutation.
- [ ] Stage all changes, validate the complete staged tree, and commit only after every operation succeeds.
- [ ] Restore runtime-trusted preimages after partial application or failed quality/verification gates and
  verify the restoration independently.
- [ ] Reconcile non-overlapping specialist proposals deterministically; conflicting proposals block rather
  than last-writer-win.
- [ ] Integrate M17 recovery decisions and M18 context deltas into the multi-file coding workflow.
- [ ] Test the 10-file minimum scenario, 100-file boundary, dependency ordering, cycle/conflict rejection,
  partial write, stale hash, quality failure, cancellation, rollback, and successful verification.

Exit gate: a disposable repository fixture completes a verified 10+ file refactor; deliberate mid-apply
and post-apply failures restore the exact original tree; all repository gates pass.

## Verification and delivery

Each milestone receives focused tests and a local full `npm run verify` before work advances to the next
milestone. The combined implementation then receives adversarial diff review, documentation synchronization,
one final local verification, and normal pull-request CI. The pull request remains unmergeable by claim until
all three exit gates and exact-head CI are green. Merge, deployment, live provider calls, and paid resources
remain separately approval-gated.

## Explicit non-goals

- No claim of zero errors, universal 50–80% token savings, 24-hour autonomy, or model equivalence.
- No hosted queue, production container/VM sandbox, public backend, mobile binary, or broad tool ecosystem.
- No weakening or disabling tests, lint, type checking, independent verification, or security policy.
- No autonomous merge, deployment, billing change, credential use, or live provider evaluation.
