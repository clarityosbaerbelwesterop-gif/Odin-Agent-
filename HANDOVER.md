# Engineering handover

Updated: 2026-09-03.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` contains the verified M0–M7 history at merge commit
  `d2a3833ea4b4069160fcca8bcf9786f2707d22a9`.
- Active branch: `agent/m8-durable-missions`; Draft PR #10 targets `main`.
- The supplied Hermes/OpenClaw report was read before architecture work. Derived KEEP, IMPROVE,
  REPLACE, and AVOID decisions remain in `docs/research/HERMES_OPENCLAW_DECISIONS.md`.

## Active milestone

M0 repository foundation, M1 provider core, M2 deterministic mission runtime, M3 fail-closed tool
runtime, M4 coding vertical slice, M5 verification engine, M6 memory/context engine, and M7
specialist coordination are merged and verified on `main`.

M8 durable missions and worker recovery is **implementation-VERIFIED**. GitHub Actions run
`33766277108` passed on head `041c42a7d506bd0c4543052f88765521dfd34ba1`: foundation validation,
Biome, strict TypeScript, and **149/149 tests** passed with aggregate coverage **88.91% lines, 76.49%
branches, and 95.24% functions**. This documentation synchronization commit must also pass before M8
is merged.

## Implemented M8 behavior

- `src/durable` uses Node 24 built-in SQLite with foreign keys, WAL, `synchronous=FULL`, bounded busy
  timeout, strict tables, explicit schema versioning, and short `BEGIN IMMEDIATE` transactions.
- Canonical M2 mission event batches persist contiguous sequence/aggregate versions, canonical UTC
  timestamps, mission-scoped idempotency fingerprints, bounded canonical JSON, and SHA-256 hashes.
  Close/reopen replay produces the same M2 projection and continues at the next version.
- Mission checkpoints are derived artifacts. Saves are idempotent, version regression/conflicting
  same-version content are rejected, and reads validate metadata/hash plus reproduce the snapshot from
  canonical events. Lower-level integrity failures are normalized to the durable corruption boundary.
- Durable jobs persist stable job/mission/task identity, priority, readiness, attempts, artifact
  references, lease generation, and lifecycle state. Raw prompts, repository contents, credentials,
  raw worker exceptions, and plaintext lease tokens are not job metadata.
- Atomic deterministic claims increment attempt and fencing generation. The claimant receives an
  opaque random token while SQLite stores only its SHA-256 hash. Heartbeat/settlement require exact
  job/mission/task/worker scope, matching generation/token, and an unexpired lease.
- Expired jobs can be reclaimed at a higher generation while attempts remain. Stale generations cannot
  settle. Retry exhaustion becomes `BLOCKED`. Running cancellation becomes `CANCELLING`, and
  cancellation defeats a late success proposal.
- `DurableJobRunner` owns timeout, heartbeat, cooperative cancellation observation, structured
  settlement, and raw-error normalization. Injected handlers receive only an immutable lease/job
  envelope plus `AbortSignal`.
- Typed hash-addressed lifecycle events expose mission-scoped strictly increasing cursors. Tampered
  event hashes fail closed. Reopen recovery resumes after a stored cursor without accepting stale
  settlement.
- The long-mission fixture persists and drains 32 jobs across interruption/reopen with one retry, one
  block, one cancellation, and deterministic final counts.

## M8 adversarial evidence

Tests cover:

- durable event idempotency and optimistic version conflicts across reopen;
- checkpoint regression/conflict/corruption and unsupported newer SQLite schema versions;
- deterministic claim ordering and two-connection lease exclusivity;
- hashed-at-rest lease tokens and stale fencing rejection;
- bounded retry ceilings and terminal block;
- cancellation-vs-late-success races;
- handler timeout, cooperative abort, and exception-message redaction;
- cursor paging, mission isolation, and lifecycle event hash tampering;
- fresh-process mission/checkpoint replay, expired-job reclaim, stale completion rejection, and the
  32-job recovery fixture.

The earlier full run `33765932493` reached 148/149 tests and exposed one useful bug: checkpoint
corruption was rejected by M2 but leaked `MissionDomainError` instead of the M8 persistence error type.
The durable boundary was repaired to normalize that failure to `DurableStoreCorruptionError`; the
subsequent full run `33766277108` passed all 149 tests. No test or gate was weakened.

## Verified evidence through M7

Canonical command:

```bash
npm ci
npm run verify
```

- M0 Actions run `33664864552` passed at `3b2886028abd2f240cc524bc7f7610d4b6558ba5`.
- M1 Actions run `33667957350` passed at `8d4f33c4bee066fc94d924a911aaa4a876a0539b`.
- M2 Actions run `33672695583` passed at `bc97c7bc206db00eb641965556a4156094ec79a7` with 41 tests.
- M3 implementation run `33675783522` passed with 55 tests; verified merge
  `0a9a76bc7ce2b52e8e879d81d3b261a8168efb29`.
- M4 implementation run `33678970596` passed with 61 tests; final documentation run
  `33679222149` passed before merge `c60ee329d66511dfbd708176c850557d48e9c9df`.
- M5 implementation run `33724426019` passed with 77 tests; documentation run `33724647879` passed.
- M6 implementation run `33752964771` passed with 108 tests; documentation run `33753281792` and
  final-evidence run `33753417686` passed.
- M7 implementation run `33755851793` passed with 132 tests; documentation run `33756217402` passed.

Provider tests remain injected-transport contracts with synthetic fixtures. Coding/verification tests
remain scripted-provider and injected workspace/tool/evidence contracts. M7 uses injected in-process
workers. M8 uses temporary local SQLite files and injected deterministic handlers. CI performs no live
provider call, production repository mutation, deployment, production migration, or paid action.

## Decisions

- Preserve the strict TypeScript modular monolith; durable state is a domain boundary, not a new
  microservice.
- Canonical mission events remain source of truth. Checkpoints are validated derivatives.
- Use Node 24 built-in SQLite for the first local durable adapter; do not add a runtime DB dependency
  before a demonstrated need.
- Treat job delivery as at least once. Fencing prevents stale database settlement but cannot undo an
  external side effect; side-effecting M3 tools still require idempotency.
- Keep model/worker output untrusted. Runtime owns leases, clock validation, heartbeat, cancellation,
  retries, settlement, budgets, and completion gates.
- Store concise durable metadata and hashes only. Lease bearer tokens are never persisted in plaintext;
  raw worker exceptions are normalized to stable reason codes.
- Keep SQLite claims local. Do not describe M8 as a hosted/distributed queue, exactly-once system,
  cross-host lock, or multi-region service.

## Open risks after M8

- The synchronized documentation head still needs its own successful pull-request CI before merge.
- SQLite does not provide distributed queue semantics, multi-host fencing, leader election,
  multi-region availability, or PostgreSQL-grade service durability.
- Worker abort remains cooperative. There is still no subprocess/container/worktree isolation,
  canonical-root/symlink-safe production repository boundary, CPU/memory/output enforcement, or
  sandbox escape protection.
- Provider adapters have not been exercised in an opt-in live end-to-end smoke test.
- M6 memory/context/cache remains in-memory; encryption at rest, retention jobs, tenant administration,
  semantic retrieval, distributed invalidation, and backups remain future work.
- Artifact references are durable metadata only; artifact bytes and repository snapshots are not yet
  persisted by M8.
- External browser/email/payment/deployment/network tools remain denied and unimplemented.
- Full skill package installation/promotion remains M10 work.

## Exact next action

Run pull-request CI on this synchronized documentation head. If all gates pass, record that exact run
and head in this handover, run one final evidence-only CI checkpoint, then merge M8 into `main` using
the already authorized merge workflow. Because PR #10 is a draft and the connector has previously
failed to undraft PRs, use the established safe workaround if necessary: close only the draft PR,
open a normal PR with the exact same verified branch head, observe PR-specific CI, then merge that
normal PR. After the merge, create M9 from the new `main` head and start the responsive web/native
client protocol milestone without weakening M8 durability boundaries.
