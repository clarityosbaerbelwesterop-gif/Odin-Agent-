# ADR-0003: Event-sourced mission persistence

- Status: accepted
- Date: 2026-09-02

## Context

Conversation replay and destructive compression are fragile foundations for multi-hour work. Odin
must resume, serve multiple clients, explain progress, and rebuild state after failure.

## Decision

Persist immutable typed mission events with per-mission sequence and optimistic aggregate version.
Build projections for current state and compact context. Checkpoints reference repository/workspace
hashes and content-addressed artifacts. External I/O never occurs inside persistence transactions.

## Consequences

Schema evolution and projection tests become mandatory. Event payloads must avoid large logs and
secrets. Local SQLite and server PostgreSQL implement the same append/load contracts.

## Verification

M2/M8 require replay equivalence, duplicate idempotency-key behavior, competing-writer rejection,
checkpoint compatibility, crash recovery, and projection-rebuild tests.
