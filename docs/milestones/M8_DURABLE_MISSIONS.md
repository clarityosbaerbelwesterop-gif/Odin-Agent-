# M8 — Durable missions and worker jobs contract

Status: implementation pending. Updated: 2026-09-03.

## Objective

Build the smallest restart-safe local runtime slice that persists canonical M2 mission events,
checkpoints, worker jobs, leases, and reconnectable lifecycle events in SQLite. Prove that a fresh
process can resume work after interruption without accepting a stale worker result or pretending that
at-least-once execution is exactly once.

M8 promotes the M7 single-process coordination contract into durable job orchestration. It does not
yet build a hosted queue, distributed scheduler, mobile UI, or production sandbox.

## Milestone slices

1. Durable M2 events and checkpoints: schema/version guard, atomic append/idempotency, optimistic
   versions, validated checkpoint persistence, close/reopen replay.
2. Durable job ledger: artifact-reference payloads, deterministic claim order, bounded attempts,
   expiring leases, fencing generations/tokens, retries, cancellation, and atomic lifecycle events.
3. Worker execution and reconnect: injected handlers, runtime-owned timeout/heartbeat/cancellation,
   stale-result rejection, cursor-based event reads, and a crash/reopen vertical test.

Each slice must pass `npm run verify` before the next begins.

## Acceptance criteria

### SQLite foundation

- Use the Node 24 built-in SQLite boundary with no new runtime dependency. Enable foreign keys, WAL,
  a bounded busy timeout, and an explicit durability mode. Schema creation/migration is versioned;
  unknown newer versions fail closed.
- Database paths are trusted runtime configuration, never model output. Tests use a unique temporary
  directory and close every connection before cleanup.
- Transactions are short and contain database work only. No model, tool, network, worker, or artifact
  I/O occurs while a write transaction is open.
- Serialized JSON is canonical, size-bounded, and validated when read. Corrupt identities, sequence,
  hashes, status, or schema values fail closed rather than being skipped.

### Durable mission events and checkpoints

- A SQLite adapter implements the existing asynchronous `EventStore<T>` contract. Appends atomically
  enforce mission aggregate version and mission-scoped idempotency fingerprints across process
  reopen. Reusing a key with different input fails.
- Stored mission events retain contiguous sequence/aggregate versions and canonical UTC timestamps.
  A fresh `MissionRuntime` over a reopened store projects the same snapshot and continues from the
  exact next version.
- A checkpoint store persists M2 `MissionCheckpoint` values as versioned derived artifacts. Save is
  idempotent, rejects conflicting content/version regression, and validates identity and hash both on
  write and read. Canonical events remain source of truth.

### Durable job ledger and fencing

- Jobs persist stable job/mission/task identity, priority, status, maximum attempts, attempt count,
  next-available time, immutable artifact payload reference/hash, lease generation, timestamps, and
  optional result artifact reference. Raw prompts, repository contents, credentials, and worker error
  strings are not job metadata.
- Enqueue is idempotent and rejects the same job ID or idempotency key with different immutable input.
  Queue and event collection sizes are bounded.
- Claiming is one atomic transaction and deterministic by readiness, priority, creation time, and job
  ID. Two store connections cannot both hold a valid lease for one job.
- Each claim increments attempt and fencing generation and returns an opaque token. Only its hash is
  stored. Heartbeat and settlement require matching job, worker, generation, and token before expiry.
  Expired, cancelled, foreign, replayed, or superseded leases cannot extend or settle work.
- Expired work becomes claimable by a new generation when attempts remain. Exhaustion becomes
  terminal `BLOCKED`. Retry delay is bounded and deterministic; the same failed strategy cannot loop
  without consuming an attempt.
- Pending/retry jobs cancel immediately. Running jobs enter `CANCELLING`; the owning runner observes
  that state, aborts cooperatively, and records terminal cancellation. Cancellation wins over a late
  success proposal.

### Runner, events, and recovery

- An injected job handler receives one immutable job/lease envelope and `AbortSignal`; it has no
  database, peer, policy, credential, or completion authority.
- The runner owns handler timeout, heartbeat cadence, cancellation observation, settlement, and error
  normalization. Raw thrown messages are not persisted. A worker outcome is bounded structured data
  and references artifacts by hash rather than embedding large output.
- Every state-changing job operation appends a typed, hash-addressed lifecycle event in the same
  transaction. Reads use a strictly increasing global cursor, exact mission scope, `after` semantics,
  and a bounded page size so a disconnected client can resume without gaps or duplicates.
- A restart test opens a second store/runtime on the same SQLite file, replays an M2 mission and its
  checkpoint, reclaims an expired in-flight job at a higher generation, rejects the old generation's
  completion, and continues the event cursor.
- A long-mission fixture persists at least 30 jobs and verifies deterministic bounded draining,
  interruption, retry, cancellation, checkpoint, reopen, and final counts without live external I/O.

## Invariants

- Mission events are canonical; checkpoints and job views are rebuildable/validated derivatives.
- Job delivery is at least once. Lease fencing prevents stale database commits but cannot undo an
  external side effect; side-effecting tools must still use M3 idempotency contracts.
- The runtime owns clock validation, leases, heartbeats, cancellation, retries, and settlement.
- A job handler never becomes mission completion authority. M5 verification and M2 transitions remain
  separate explicit steps.
- Durable does not mean distributed: SQLite is the local single-runtime persistence target.
- Stored events contain concise decision/state metadata and hashes, never private chain of thought.

## Out of scope

- PostgreSQL, hosted queues, multi-region/high-availability scheduling, leader election, or distributed
  clock/fencing guarantees.
- Real worker RPC, subprocess/container/worktree isolation, CPU/memory/output enforcement, or sandbox
  escape protection.
- WebSocket/SSE transport, push notifications, mobile UI, authentication, tenant/device sessions, or
  offline client mutation; M8 provides the cursor contract consumed later.
- Artifact byte storage, repository snapshots, automatic patch merge, tool execution, live providers,
  external network, deployment, or paid operations.
- Exactly-once external effects. Odin can guarantee only transactional state changes plus idempotent
  replay contracts at this boundary.

## Verification strategy

Use only local temporary SQLite files, injected deterministic job handlers, and fake/controlled clocks.
Run `npm run verify`, close/reopen the database in recovery tests, and inspect the final diff. M8 is
`VERIFIED` only after implementation, adversarial repair, synchronized documentation, and pull-request
CI evidence all pass.
