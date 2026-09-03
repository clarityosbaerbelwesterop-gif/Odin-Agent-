# M8 — Durable missions and worker jobs contract

Status: `VERIFIED`. Updated: 2026-09-03.

## Objective

Build the smallest restart-safe local runtime slice that persists canonical M2 mission events,
checkpoints, worker jobs, leases, and reconnectable lifecycle events in SQLite. Prove that a fresh
process can resume work after interruption without accepting a stale worker result or pretending that
at-least-once execution is exactly once.

M8 promotes the M7 single-process coordination contract into durable job orchestration. It does not
build a hosted queue, distributed scheduler, mobile UI, or production sandbox.

## Milestone slices

1. Durable M2 events and checkpoints: schema/version guard, atomic append/idempotency, optimistic
   versions, validated checkpoint persistence, close/reopen replay.
2. Durable job ledger: artifact-reference payloads, deterministic claim order, bounded attempts,
   expiring leases, fencing generations/tokens, retries, cancellation, and atomic lifecycle events.
3. Worker execution and reconnect: injected handlers, runtime-owned timeout/heartbeat/cancellation,
   stale-result rejection, cursor-based event reads, and a crash/reopen vertical test.

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
- Each claim increments attempt and fencing generation and returns an opaque token. Only its SHA-256
  hash is stored. Heartbeat and settlement require matching job, worker, generation, and token before
  expiry. Expired, cancelled, foreign, replayed, or superseded leases cannot extend or settle work.
- Expired work becomes claimable by a new generation when attempts remain. Exhaustion becomes
  terminal `BLOCKED`. Retry delay is bounded and deterministic; repeated failure consumes attempts.
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
- A restart test opens a fresh store/runtime on the same SQLite file, replays an M2 mission and its
  checkpoint, reclaims expired in-flight work at a higher generation, rejects the old generation's
  completion, and continues the event cursor.
- A long-mission fixture persists 32 jobs and verifies deterministic bounded draining, retry,
  cancellation, blocking, reopen, and final counts without live external I/O.

## Invariants

- Mission events are canonical; checkpoints and job views are validated derivatives.
- Job delivery is at least once. Lease fencing prevents stale database commits but cannot undo an
  external side effect; side-effecting tools must still use M3 idempotency contracts.
- The runtime owns clock validation, leases, heartbeats, cancellation, retries, and settlement.
- A job handler never becomes mission completion authority. M5 verification and M2 transitions remain
  separate explicit steps.
- Durable does not mean distributed: SQLite is the local single-runtime persistence target.
- Stored events contain concise state metadata and hashes, never private chain of thought.

## Implemented design

`src/durable/store.ts` uses Node 24's built-in SQLite API with foreign keys, WAL, bounded busy timeout,
FULL synchronous durability, strict schema tables, and a version guard. It implements the existing M2
mission event-store contract, validates persisted mission-event JSON through `mission-codec.ts`,
persists integrity-checked checkpoints, and stores durable job/job-event state. Reads fail closed on
identity, sequence, schema, JSON, or hash corruption.

Job claims are serialized by short immediate transactions and ordered deterministically. Claims
increment attempt and lease generation, return an opaque lease token, and persist only its SHA-256
hash. Heartbeat and settlement are fenced by job, worker, generation, token, and expiry. Expired work
may be reclaimed at a higher generation; a stale generation cannot settle. Attempt exhaustion blocks
the job. Cancellation wins over late success.

`src/durable/runner.ts` owns claim, timeout, heartbeat, cancellation observation, cooperative abort,
and settlement around an injected handler. Handler exceptions are normalized to stable reason codes;
raw worker error strings are not written to durable lifecycle events. Mission-scoped job-event reads
use a bounded strictly increasing cursor and validate event hashes before returning data.

## Verification evidence

GitHub Actions run `33766161672` passed on implementation/documentation checkpoint
`7ca2e5ee3a7ff0d34641dcdf7a0418a4e90fec04` after adversarial repairs:

- foundation validation: passed;
- Biome: passed;
- strict TypeScript: passed;
- tests: **149 passed, 0 failed**;
- aggregate coverage: **88.91% lines, 76.49% branches, 95.24% functions**.

M8 regression evidence includes exact mission replay after close/reopen, persistent idempotency,
checkpoint version/integrity checks, newer-schema denial, deterministic claim ordering, concurrent
connection fencing, lease-token hash secrecy, stale-generation denial, attempt exhaustion, retry,
cancellation-wins, lifecycle cursor paging, lifecycle-hash corruption denial, fresh-process recovery,
a 32-job reopen fixture, normalized handler errors, timeout abort, and cooperative cancellation.

A final synchronized documentation CI checkpoint is required to preserve these claims after the repo
status files are updated. No M8 verification run uses live inference, an external network tool,
production workspace mutation, deployment, migration, or paid resource.

## Out of scope and remaining limits

- PostgreSQL, hosted queues, multi-region/high-availability scheduling, leader election, or distributed
  clock/fencing guarantees.
- Real worker RPC, subprocess/container/worktree isolation, CPU/memory/output enforcement, or sandbox
  escape protection. The verified runner uses injected in-process handlers.
- WebSocket/SSE transport, push notifications, mobile UI, authentication, tenant/device sessions, or
  offline client mutation; M8 provides the durable cursor contract consumed by later client work.
- Artifact byte storage, repository snapshots, automatic patch merge, tool execution, live providers,
  external network, deployment, or paid operations.
- Exactly-once external effects. Odin guarantees transactional local state changes and replay/fencing
  contracts at this boundary; external side effects still require M3 idempotency.
- M6 memory, M3 audit, and M5 verification-result durability are not automatically promoted to SQLite
  by this milestone unless explicitly wired through later storage adapters.
