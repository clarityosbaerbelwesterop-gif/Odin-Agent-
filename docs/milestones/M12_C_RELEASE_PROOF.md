# M12-C — Observability, recovery evidence, and release gates

Status: local implementation VERIFIED; full M12 remains PARTIALLY_VERIFIED pending authorized live/infrastructure proof. Updated: 2026-09-04.

## Objective

Complete the no-cost portion of M12 without overstating infrastructure evidence. M12-C turns local
hardening results into typed, integrity-checked, secret-safe evidence and fails closed when a release
claim asks for evidence that was not actually produced.

## Evidence classes

M12-C distinguishes three ordered evidence levels:

1. `local` — deterministic repository/CI/local-runtime proof;
2. `integration` — proof from an explicitly available host/container/service integration;
3. `live` — proof from explicitly authorized live provider/sandbox/production infrastructure.

Higher-level claims must include all configured lower-level requirements. A `local` record can never be
relabelled as `integration` or `live` merely because a release wants a stronger claim.

## Structured observability

- typed event kind, severity, reason code, canonical UTC timestamp, mission/task scope, and bounded
  metadata;
- deterministic SHA-256 event identity over canonical non-secret fields;
- no raw credentials, full process environment, private chain-of-thought, or unbounded stdout/stderr;
- dangerous metadata keys and obvious secret-bearing values fail closed rather than being silently logged;
- deterministic bounded in-memory sink for local verification and future adapter substitution.

## Release evidence and gate

- immutable evidence records bind exact evidence level, producer, subject, status, timestamp, and
  content hash;
- release manifest binds exact commit SHA, configuration profile identity/hash, required evidence IDs,
  test/evaluation suite identity/hash, and requested claim level;
- manifest identity is canonical and deterministic;
- release gate validates hashes, scope, freshness, required evidence kinds/statuses/levels, and exact
  referenced evidence IDs;
- missing, stale, foreign, failed, tampered, duplicated, or weaker-than-required evidence blocks;
- release gate never performs deployment or external side effects.

## Backup/recovery contract

- backup manifests identify source adapter/schema, created timestamp, bounded artifact reference/hash,
  and integrity metadata;
- restore verification binds a backup manifest to an independently computed restored-state hash;
- local backup/recovery evidence must not claim cloud redundancy, point-in-time recovery, or production
  disaster recovery unless those capabilities are separately integrated and exercised.

## Deterministic load/recovery proof

Tests must cover bounded fixtures for:

- cancellation/timeout/output pressure;
- sandbox allocation replay, concurrent collapse, release replay, and released-session denial;
- durable M8 reopen/lease recovery evidence references;
- bounded observability capacity and deterministic event ordering;
- tampered release/backup evidence;
- a local release gate PASS and deliberate higher-level claim BLOCK.

## Out of scope without separate authorization

- live model-provider calls;
- hosted sandbox calls or paid sandbox creation;
- production deployment or migration;
- public traffic/customer data;
- billing changes;
- claiming integration/live evidence from local fixtures.

M12-C finishes the **local deterministic** M12 release-proof tranche. Full M12 remains
`PARTIALLY_VERIFIED` until every live/infrastructure claim required by ROADMAP has matching evidence.

## Verified repository evidence

- Normal PR CI run `33796268313` passed on implementation head `5e2a387ca2b2fd4905ac03560df4878be7cda35b`.
- 258/258 tests passed with 0 failures.
- Aggregate coverage: 89.29% lines, 76.24% branches, 95.64% functions.
- The end-to-end local release fixture passes `local` using repository verify + recovery + restore evidence and deliberately blocks `integration` and `live` without stronger evidence.
- The sandbox load fixture proves concurrent create collapse and single remote destroy; conflicting concurrent release reasons fail closed.
- One-shot documentation synchronization run `33836629270` completed successfully and removed its helper workflow in the same commit.

A final normal PR-specific `npm run verify` on this synchronized human-authored head is the remaining merge gate for PR #16.
