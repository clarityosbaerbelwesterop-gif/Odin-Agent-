# Engineering handover

Updated: 2026-09-03.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` contains the verified M0–M4 history at merge commit
  `c60ee329d66511dfbd708176c850557d48e9c9df`.
- M5 branch: `agent/m5-verification-engine`; Draft PR #7 targets `main`.
- M6 branch: `agent/m6-memory-context`; stacked Draft PR #8 targets the M5 branch.
- Work branch: `agent/m7-specialist-coordination`; stacked Draft PR #9 targets the M6 branch.
- The supplied Hermes/OpenClaw report was read in full before architecture work. Derived KEEP,
  IMPROVE, REPLACE, and AVOID decisions remain in
  `docs/research/HERMES_OPENCLAW_DECISIONS.md`.

## Active milestone

M0 repository foundation, M1 provider core, M2 deterministic mission runtime, M3 fail-closed tool
runtime, and M4 coding vertical slice are merged and verified in pull-request CI.

M5 is verified in pull-request CI and remains unmerged pending explicit authorization. M6 was branched
from that verified head. Its memory/context implementation passed Actions run `33752964771`, and its
synchronized documentation passed run `33753281792`. M6 is `VERIFIED`; the M5 and M6 pull requests
remain draft and unmerged.

M7 was branched from the verified M6 head. Its specialist registry, ownership-aware planning,
bounded parallel execution, runtime evidence attestation, and reconciliation implementation passed
Actions run `33755851793`. Synchronized documentation passed run `33756217402`. M7 is `VERIFIED`;
all three pull requests remain draft and unmerged.

Odin still does not claim a production coding agent, OS-level sandbox, arbitrary shell execution,
external network tools, durable database persistence, live-provider end-to-end compatibility, mobile
client, hosted service, or complete MVP.

## Verified evidence

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
  `f28bcb9758c2079d9f46826ea672c19bd6e538ff`: foundation validation, Biome, and strict TypeScript
  passed; 77 tests passed with 0 failures; aggregate coverage was 87.83% lines, 74.73% branches, and
  94.29% functions.
- M5 synchronized-documentation run `33724647879` passed at
  `2221ad823348f3bbd4a9b8fc703bb5f460cd6888`.
- M6 implementation run `33752964771` passed at
  `8934e8f3956db0a66528f484faf34a7e8ea92628`: foundation validation, Biome, and strict TypeScript
  passed; 108 tests passed with 0 failures; aggregate coverage was 88.92% lines, 76.53% branches, and
  95.25% functions.
- M6 synchronized-documentation run `33753281792` passed at
  `df6d310adcf2882e26a6bb7d6f8a4165c080e7ea`.
- M6 final-evidence run `33753417686` passed at
  `853b06243129a8e3b6ef01aa6311d38bfd55fc95`.
- M7 implementation run `33755851793` passed at
  `88cedbb8b33cb9863a0b4b1b30abbd6ec2e2cb19`: foundation validation, Biome, and strict TypeScript
  passed; 132 tests passed with 0 failures; aggregate coverage was 88.95% lines, 77.46% branches,
  and 95.19% functions.
- M7 synchronized-documentation run `33756217402` passed at
  `91cc54b367f3f946988a80243ac2dbe5d2c485f7` with the same 132 tests and coverage.

Provider tests remain injected-transport contracts with synthetic fixtures. M4/M5 integration tests
remain scripted-provider, in-memory event/audit, and injected workspace/quality contracts. CI performs
no live provider call, network tool action, production repository mutation, deployment, or paid action.
M7 uses injected in-process deterministic workers and an injected fixture evidence authority; it does
not invoke a model, subagent service, external worker, or repository write.

## Implemented M6 behavior

- Async memory contracts distinguish working, episodic, semantic, project, and explicit user
  preferences without conflating procedural skills.
- The in-memory contract adapter validates scope, provenance, hashes, canonical time, expiry,
  sensitivity, optimistic versions, idempotency, and deterministic lexical/tag retrieval.
- Working memory is mission-bound; user preferences require explicit-user provenance; tombstones
  remove raw content and cached/replay paths and prohibit same-ID resurrection.
- Context candidates have fixed P0–P6 source classes. P0–P2 remain mandatory, and repository/current
  sources deterministically override semantically conflicting memory/history.
- The compiler owns bounded item/section/total estimates, explicit drop reasons, deterministic hashes,
  and an immutable content-addressed cache that excludes sensitive inputs.
- The facade performs scoped retrieval asynchronously, injects memory as P5 only, and invalidates
  affected cache entries on memory changes.
- Typed session snapshots preserve mission/task/test state plus the canonical raw-history reference and
  reject foreign, stale, malformed, or hash-tampered state.

## Decisions

- Preserve the strict TypeScript modular monolith; memory and context are domain boundaries, not new
  services.
- Use asynchronous storage contracts now so later SQLite/PostgreSQL adapters do not require a breaking
  runtime interface.
- Treat memory as retrieved P5 evidence, never policy or instruction. Current repository/state sources
  win conflicts.
- Keep raw events canonical. Structured snapshots are deterministic derived views with exact source
  pointers, not destructive summaries.
- Use a documented approximate tokenizer for deterministic budgeting now; exact provider tokenizers
  and empirical allocation remain M11.
- Skip the cache whenever any candidate is sensitive; correctness and privacy outrank cache hit rate.
- Keep specialist selection, ownership, leases, concurrency, cancellation, and reconciliation in the
  deterministic runtime; workers receive one immutable proposal contract and cannot talk to peers.
- Treat repository/resource/state ownership as conservative logical locking before execution. Do not
  describe this as a durable/distributed lock, worktree, process sandbox, or symlink-safe boundary.
- Require runtime evidence attestation for M7 acceptance. A worker-supplied `independent_tool` label is
  not authority, and M7 acceptance still cannot replace M5 task/mission verification.

## Implemented M7 behavior

- The bounded registry stores versioned role/capability/provenance/trust metadata separately from
  injected worker handlers and returns deterministic compact discovery summaries.
- Only dependency-ready `PENDING` tasks in an `EXECUTING` M2 mission are eligible. Missing specs,
  specialists, capacity, and ownership are explicit typed deferrals.
- Repository ancestor/descendant overlap is conservative; resource and state keys conflict exactly;
  read/read sharing is permitted and any intersecting write is deferred.
- Plans, assignments, and expiring leases are generation-bound, immutable, hash-addressed, and
  replay-checked. Clock rollback fails closed.
- Strict proposals include bounded summary/evidence/files/artifacts/assumptions/risks/remaining work.
  Foreign or malformed output, unowned file writes, and unsupported fields are blocked.
- Independent passing evidence must be attested by a runtime-owned authority. Reconciliation is
  deterministic data only and releases leases on success, failure, timeout, cancellation, or expiry.
- A barrier-based test proves two different specialists actually enter execution concurrently, while
  partial failure preserves an independently accepted sibling result.

## Open risks

- Provider adapters have not been exercised in an opt-in live end-to-end smoke test.
- Repository workspace and quality adapters remain injected seams; production sandboxing,
  canonical-root/symlink enforcement, process isolation, CPU/memory/output limits, and worker leases
  are not implemented.
- Mission events, checkpoints, tool audit records, and verification results are not backed by
  SQLite/PostgreSQL durability or an artifact store.
- M6 memory, snapshots, and context cache are in-memory contracts; encryption at rest, retention jobs,
  tenant administration, semantic/vector retrieval, distributed invalidation, and backups are not
  implemented.
- M7 plans and leases are single-process and in memory. Worker abort is cooperative; workers are not
  isolated in subprocesses/containers/worktrees, locks are not durable or cross-host fenced, and
  coordination cannot yet recover after process restart.
- A blocked M5 evidence package cannot yet be recollected and resumed automatically; the bounded
  request is exposed for a later controller/repair workflow.
- External network/browser/email/payment/deployment tools remain denied and unimplemented.
- Full skill package installation/promotion remains M10 work.
- Branch protection and required-check repository settings remain outside this code checkpoint.

## Exact next action

Keep PR #7, stacked PR #8, and stacked PR #9 unmerged until explicitly authorized. Start M8 with a
task contract for persistent worker jobs, durable leases, event fan-out, reconnect, cancellation, and
restart recovery. Preserve the M7 coordinator contract and do not claim process isolation,
distributed fencing, worktree safety, or durable recovery before M8 adds and verifies that evidence.
