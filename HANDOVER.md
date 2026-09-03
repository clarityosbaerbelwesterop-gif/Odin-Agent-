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

M8 implementation is present on `agent/m8-durable-missions` but is **not yet declared VERIFIED**.
It adds the local durable runtime slice required by `docs/milestones/M8_DURABLE_MISSIONS.md`:

- SQLite-backed canonical M2 mission events with optimistic versions and durable idempotency;
- integrity-checked derived mission checkpoints that are revalidated against canonical events;
- durable worker jobs with bounded attempts, deterministic claims, expiring leases, fencing
  generations, opaque lease tokens whose hashes alone are stored, retries, cancellation, and
  lifecycle events;
- runtime-owned handler timeout, heartbeat, cooperative cancellation, structured settlement, and
  normalized worker errors;
- cursor-based mission-scoped lifecycle replay and close/reopen recovery;
- adversarial fixtures covering two SQLite connections, stale settlement rejection, corruption,
  cancellation-vs-success, retry exhaustion, and a 32-job interrupted mission.

The latest full user-authored CI attempt, run `33765932493`, reached all tests: foundation, Biome, and
strict TypeScript passed; 148/149 tests passed. The single failure exposed a boundary-normalization bug:
a corrupted checkpoint was correctly rejected by M2 but leaked `MissionDomainError` instead of the
M8 persistence error type. The durable boundary now catches that lower-level integrity failure and
normalizes it to `DurableStoreCorruptionError` at commit
`3b40a30c36a6a30043707a5c029d56d7a449f8a3`. That bot-authored commit received GitHub Actions
`action_required`, so this synchronized handover commit intentionally triggers the next normal
pull-request CI run over the repaired code.

Odin still does not claim a production OS sandbox, arbitrary shell execution, external network tools,
live-provider end-to-end compatibility, hosted distributed queue, PostgreSQL durability, mobile
client, hosted service, or complete MVP.

## Verified evidence through M7

Canonical command:

```bash
npm ci
npm run verify
```

- M0 Actions run `33664864552` passed at `3b2886028abd2f240cc524bc7f7610d4b6558ba5`.
- M1 Actions run `33667957350` passed at `8d4f33c4bee066fc94d924a911aaa4a876a0539b`.
- M2 Actions run `33672695583` passed at `bc97c7bc206db00eb641965556a4156094ec79a7`
  with 41 tests.
- M3 implementation run `33675783522` passed with 55 tests; its verified merge is
  `0a9a76bc7ce2b52e8e879d81d3b261a8168efb29`.
- M4 implementation run `33678970596` passed with 61 tests, and final documentation run
  `33679222149` passed before merge `c60ee329d66511dfbd708176c850557d48e9c9df`.
- M5 implementation run `33724426019` passed at
  `f28bcb9758c2079d9f46826ea672c19bd6e538ff`: 77 tests passed with 0 failures.
- M5 synchronized-documentation run `33724647879` passed at
  `2221ad823348f3bbd4a9b8fc703bb5f460cd6888`.
- M6 implementation run `33752964771` passed at
  `8934e8f3956db0a66528f484faf34a7e8ea92628`: 108 tests passed with 0 failures.
- M6 synchronized-documentation run `33753281792` passed at
  `df6d310adcf2882e26a6bb7d6f8a4165c080e7ea`; final-evidence run `33753417686` also passed.
- M7 implementation run `33755851793` passed at
  `88cedbb8b33cb9863a0b4b1b30abbd6ec2e2cb19`: 132 tests passed with 0 failures.
- M7 synchronized-documentation run `33756217402` passed at
  `91cc54b367f3f946988a80243ac2dbe5d2c485f7` with the same 132 tests.

Provider tests remain injected-transport contracts with synthetic fixtures. M4/M5 integration tests
remain scripted-provider, in-memory audit, and injected workspace/quality contracts. M7 uses injected
in-process deterministic workers and an injected fixture evidence authority. None of those CI paths
perform live provider calls, production repository mutation, deployment, or paid actions.

## M8 design decisions

- Keep the strict TypeScript modular monolith and use Node 24 built-in `node:sqlite`; no new runtime
  database dependency is introduced.
- Canonical mission events remain source of truth. Checkpoints are validated derived artifacts and
  must reproduce from the event stream before acceptance.
- Use WAL, foreign keys, explicit FULL synchronous durability, bounded busy timeout, strict tables,
  short `BEGIN IMMEDIATE` transactions, schema versioning, bounded canonical JSON, and fail-closed
  decoding.
- Treat local SQLite as a single-runtime persistence target, not a distributed queue or globally
  ordered execution system.
- Job delivery is at least once. Fencing prevents stale database settlement but cannot undo an
  external side effect; M3 idempotency remains mandatory for side-effecting tools.
- Workers receive immutable lease/job envelopes plus `AbortSignal`. Database handles, credentials,
  policy state, peer communication, and completion authority stay runtime-owned.
- Lease tokens are opaque bearer material returned only to the claimant; persistence stores only a
  SHA-256 token hash. Raw worker exceptions are normalized to stable reason codes.
- Cursor reconnect is mission-scoped and strictly monotonic. Tampered lifecycle event hashes fail
  closed instead of being skipped.

## Open risks after M8 implementation

- M8 is not verified until the repaired implementation and synchronized documentation both pass
  pull-request CI and final evidence is recorded.
- SQLite does not provide distributed queue semantics, multi-host fencing, leader election,
  multi-region availability, or PostgreSQL-grade service durability.
- Worker abort remains cooperative. There is still no subprocess/container/worktree isolation,
  symlink-safe production repository boundary, CPU/memory/output enforcement, or sandbox escape
  protection.
- Provider adapters have not been exercised in an opt-in live end-to-end smoke test.
- M6 memory/context/cache remains in-memory; encryption at rest, tenant administration, semantic
  retrieval, retention jobs, distributed invalidation, and backups remain future work.
- Artifact references are durable metadata only; artifact bytes and repository snapshots are not yet
  stored by M8.
- External browser/email/payment/deployment/network tools remain denied and unimplemented.
- Full skill package installation/promotion remains M10 work.

## Exact next action

Run pull-request CI on the repaired M8 head through `npm run verify`. If all gates pass, update
`ROADMAP.md` and `docs/milestones/M8_DURABLE_MISSIONS.md` to `VERIFIED`, record the exact run/head in
this handover, run synchronized-documentation CI once more, then merge PR #10 only after the final
verified head is mergeable. After merge, branch M9 from the new `main` head and start the responsive
web/native-client protocol milestone without weakening the M8 durability boundaries.
