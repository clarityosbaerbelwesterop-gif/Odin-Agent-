# Engineering handover

Updated: 2026-09-03.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` contains the verified M0–M4 history at merge commit
  `c60ee329d66511dfbd708176c850557d48e9c9df`.
- M5 branch: `agent/m5-verification-engine`; Draft PR #7 targets `main`.
- Work branch: `agent/m6-memory-context`; stacked Draft PR #8 targets the M5 branch.
- The supplied Hermes/OpenClaw report was read in full before architecture work. Derived KEEP,
  IMPROVE, REPLACE, and AVOID decisions remain in
  `docs/research/HERMES_OPENCLAW_DECISIONS.md`.

## Active milestone

M0 repository foundation, M1 provider core, M2 deterministic mission runtime, M3 fail-closed tool
runtime, and M4 coding vertical slice are merged and verified in pull-request CI.

M5 is verified in pull-request CI and remains unmerged pending explicit authorization. M6 was branched
from that verified head. Its memory/context implementation passed Actions run `33752964771`, and its
synchronized documentation passed run `33753281792`. M6 is `VERIFIED`; both stacked pull requests
remain draft and unmerged.

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

Provider tests remain injected-transport contracts with synthetic fixtures. M4/M5 integration tests
remain scripted-provider, in-memory event/audit, and injected workspace/quality contracts. CI performs
no live provider call, network tool action, production repository mutation, deployment, or paid action.

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
- A blocked M5 evidence package cannot yet be recollected and resumed automatically; the bounded
  request is exposed for a later controller/repair workflow.
- External network/browser/email/payment/deployment tools remain denied and unimplemented.
- Full skill package installation/promotion remains M10 work.
- Branch protection and required-check repository settings remain outside this code checkpoint.

## Exact next action

Keep PR #7 and stacked PR #8 unmerged until explicitly authorized. Create the M7 task contract from
the verified M6 head, then implement the smallest specialist/ownership/reconciliation slice with
dependency and file/resource conflict tests. Do not claim durable database memory, embeddings,
production cache coherence, or multi-agent safety beyond evidence added by that later slice.
