# ADR-0001: Deterministic mission state machine

- Status: accepted
- Date: 2026-09-02

## Context

Free-running model loops obscure why a mission advanced, make cancellation and recovery unsafe, and
allow model confidence to substitute for completion evidence.

## Decision

The runtime owns a closed, typed state-transition table. Models may propose actions but cannot mutate
canonical state directly. Transitions check current version, preconditions, policy, budget, and
idempotency. Verification failure enters diagnosis/repair; it cannot jump to completion.

## Alternatives

- Prompt-only loop: simpler, but not reliably resumable or auditable.
- General workflow engine first: powerful, but premature before Odin's domain transitions are known.

## Consequences

Additional domain code and transition tests are required. In return, pause, resume, cancellation,
retry, final audit, and progress reporting become deterministic.

## Verification

M2 must provide transition-table, forbidden-transition, replay, concurrency, pause/resume, cancel,
repair-loop, and terminal-state tests.
