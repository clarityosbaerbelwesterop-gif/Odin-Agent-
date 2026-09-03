# Engineering handover

Updated: 2026-09-03.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` contains verified M0–M7 at merge commit
  `d2a3833ea4b4069160fcca8bcf9786f2707d22a9`.
- Active branch: `agent/m8-durable-missions`; Draft PR #10 targets `main`.
- M8 implementation and synchronized documentation are verified. One final evidence-only CI checkpoint
  is required before merge.

## M8 verified capability

M8 adds the first restart-safe local persistence and worker-job boundary in `src/durable`:

- Node 24 built-in SQLite with foreign keys, WAL, `synchronous=FULL`, bounded busy timeout, strict
  tables, explicit schema versioning, and short `BEGIN IMMEDIATE` transactions;
- canonical M2 mission-event persistence with optimistic versions, mission-scoped idempotency,
  contiguous sequence/version identity, canonical UTC timestamps, bounded canonical JSON, hashes,
  close/reopen replay, and fail-closed decoding;
- derived checkpoints that reject version regression/conflict/corruption and reproduce from canonical
  events before acceptance;
- durable jobs with deterministic atomic claim order, bounded attempts, expiring leases, fencing
  generations, opaque tokens stored only as SHA-256 hashes, retries, cancellation, and terminal block;
- a runtime-owned runner for timeout, heartbeat, cooperative cancellation, structured settlement, and
  raw worker-error normalization;
- hash-addressed mission-scoped lifecycle events with strictly increasing reconnect cursors;
- fresh-process recovery that replays mission/checkpoint state, reclaims expired work at a higher
  generation, rejects stale settlement, resumes the cursor, and drains a 32-job interrupted fixture.

M8 is intentionally **at least once**. Lease fencing prevents stale database settlement but cannot
undo an external side effect. Side-effecting M3 tools still require their own idempotency contract.
SQLite is a local single-runtime durability target, not a hosted queue, exactly-once system,
cross-host lock, leader-election service, or multi-region database.

## M8 evidence

Canonical command:

```bash
npm ci
npm run verify
```

Observed successful checkpoints:

- run `33766161672` passed on `7ca2e5ee3a7ff0d34641dcdf7a0418a4e90fec04` after the main
  adversarial implementation repairs;
- run `33766277108` passed on `041c42a7d506bd0c4543052f88765521dfd34ba1` with the repaired
  checkpoint-corruption error normalization;
- synchronized documentation run `33766944528` passed on
  `1e1bc56b7e19ef34a4aef4950f681955f004c649` after README, architecture, security, roadmap, and
  handover were aligned with M8.

The verified M8 suite has **149 tests, 149 passes, 0 failures**. Aggregate coverage is **88.91% lines,
76.49% branches, and 95.24% functions**.

Adversarial cases include event idempotency and optimistic conflicts across reopen, checkpoint
regression/conflict/corruption, unsupported newer SQLite schemas, deterministic claim order,
two-connection lease exclusion, token-hash secrecy, stale fencing rejection, retry exhaustion,
cancellation defeating late success, handler timeout/abort and raw-error redaction, mission-scoped
cursor paging, lifecycle-hash tampering, fresh-process expired-job reclaim, and the 32-job fixture.

A useful red-to-green sequence was preserved rather than hidden: run `33765932493` reached 148/149
and exposed that a corrupted checkpoint leaked `MissionDomainError` from M2. The durable boundary was
fixed to normalize this to `DurableStoreCorruptionError`; no test or gate was weakened.

## Earlier verified evidence

- M0 run `33664864552`.
- M1 run `33667957350`.
- M2 run `33672695583` with 41 tests.
- M3 implementation run `33675783522`; verified merge
  `0a9a76bc7ce2b52e8e879d81d3b261a8168efb29`.
- M4 implementation run `33678970596`; documentation run `33679222149`; merge
  `c60ee329d66511dfbd708176c850557d48e9c9df`.
- M5 implementation run `33724426019` with 77 tests; documentation run `33724647879`.
- M6 implementation run `33752964771` with 108 tests; documentation run `33753281792`; final
  evidence run `33753417686`.
- M7 implementation run `33755851793` with 132 tests; documentation run `33756217402`.

Provider tests remain injected-transport fixtures. Coding/verification tests remain scripted-provider
and injected workspace/tool/evidence contracts. M7 uses injected in-process workers. M8 uses temporary
local SQLite files and injected handlers. CI performs no live provider call, external tool write,
production repository mutation, production migration, deployment, or paid action.

## Security and architecture boundaries

- The model and specialists remain untrusted proposal producers. Runtime/policy/verification decide.
- M3 repository path guards are defense in depth, not canonical-root/symlink or OS-sandbox proof.
- M7 repository/resource/state ownership remains in-memory logical coordination. M8 durable job leases
  do not convert those claims into distributed repository locks.
- Worker abort is cooperative; no subprocess/container/worktree, CPU/memory/output enforcement, or
  sandbox-escape protection is claimed yet.
- Lease bearer tokens are never stored in plaintext; raw worker exceptions are reduced to stable reason
  codes before durable lifecycle storage.
- Canonical mission events are source of truth; checkpoints are validated derivatives.
- M6 memory/context/cache, M3 audit records, M5 verification results, and artifact bytes are not
  automatically persisted by M8.

## Open risks / remaining MVP work

- responsive user-facing web/mobile client and versioned reconnect protocol are not implemented;
- production worker/process sandbox and real repository/worktree isolation are not implemented;
- live provider end-to-end smoke is not yet proven;
- M6 memory persistence/encryption/retention and artifact byte storage remain future work;
- server/team PostgreSQL or hosted queue durability, cross-host fencing, backups, HA, and load/recovery
  hardening remain future milestones;
- full skill package lifecycle remains M10;
- empirical routing/cost optimization remains M11;
- release hardening/observability/evals remain M12.

## Exact next action

Run `npm run verify` once more on the evidence-only head that records run `33766944528`. If that final
pull-request CI passes and the branch remains mergeable, close only Draft PR #10 if the connector still
cannot undraft it, open a normal PR with the **exact same verified head**, observe PR-specific CI, and
merge that normal PR using the user's existing merge authorization. Never force-update `main` or bypass
a failing check. Then branch M9 from the new `main` merge head and begin the responsive web/native
client protocol milestone on top of M8's durable state and reconnect cursor.
