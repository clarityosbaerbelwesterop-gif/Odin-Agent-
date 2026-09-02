# M2 — Mission runtime task contract

Status: `VERIFIED`. Updated: 2026-09-02.

## Objective

Build the deterministic mission-control core that survives model mistakes and process interruption.
M2 owns mission state, task dependency ordering, budgets, retries/circuit breaking, cancellation,
append-only events, optimistic concurrency, checkpoints, and replay. It performs no model or tool I/O.

## Acceptance criteria

- Mission lifecycle uses a closed typed transition table; forbidden transitions fail before state is
  persisted.
- Pause/resume preserves the exact safe pre-pause state; cancellation reaches a terminal state and
  terminal missions cannot be revived by normal commands.
- Task definitions form a validated DAG with no missing dependencies, duplicates, or cycles; runnable
  work is selected deterministically from verified dependency state.
- Budget accounting uses integer counters and rejects any debit that would exceed configured token,
  cost, tool-call, or attempt ceilings.
- Equivalent failure signatures are counted deterministically and a bounded anti-loop circuit breaker
  prevents the same failing strategy from being retried forever.
- Mission facts are appended as immutable typed events with per-mission sequence numbers, optimistic
  aggregate versions, and idempotency-key replay protection.
- A mission rebuilt from its event stream is equivalent to the live projection.
- Versioned checkpoints contain enough projection data to resume after interruption and reject
  incompatible/tampered identity metadata.
- No external network/model/tool call occurs while state is being appended or replayed.

## Invariants

- Conversation history is never canonical mission state.
- The runtime, not a model, decides transitions, budgets, retry permission, and completion eligibility.
- All counters are non-negative safe integers; monetary budget is represented in integer micros.
- Event append is atomic at the store contract boundary: either the complete batch is accepted at the
  expected version or no event from that batch becomes visible.
- Idempotency keys are scoped to one mission and may not be reused for a different event batch.
- Checkpoints are optimization/recovery artifacts; immutable events remain the source of truth.
- M2 does not claim durable SQLite/PostgreSQL persistence. It defines and contract-tests the append
  interface with an in-memory adapter; a durable adapter is a later vertical-slice dependency.

## Out of scope

- Tool execution, sandboxing, filesystem mutation, and capability grants (M3).
- Planner/model calls and repository coding loop (M4).
- Full independent verification engine (M5).
- SQLite/PostgreSQL implementation and multi-process leases (later persistence hardening).
- Web/mobile event fan-out (M8/M9).

## Verification

GitHub Actions run `33672695583` passed for commit
`bc97c7bc206db00eb641965556a4156094ec79a7` using `npm run verify`.

Evidence:

- 41 tests passed, 0 failed;
- Biome passed with no findings;
- strict TypeScript typecheck passed;
- aggregate coverage: 84.58% lines, 72.80% branches, 90.91% functions;
- `src/mission/runtime.ts`: 96.92% line coverage and 87.12% branch coverage;
- `src/events/store.ts`: 95.00% line coverage and 82.76% branch coverage;
- interruption/recovery continuation, optimistic conflicts, strict idempotency, checkpoint integrity,
  budget rejection, DAG validation, pause/resume/cancel, and anti-loop failure handling are covered.

No live model/provider call, tool execution, external network access, or paid resource was used by M2
verification.
