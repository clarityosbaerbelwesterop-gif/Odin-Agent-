# Engineering handover

Updated: 2026-09-03.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` contains the verified M0–M4 history at merge commit
  `c60ee329d66511dfbd708176c850557d48e9c9df`.
- Work branch: `agent/m5-verification-engine`; Draft PR #7 targets `main`.
- The supplied Hermes/OpenClaw report was read in full before architecture work. Derived KEEP,
  IMPROVE, REPLACE, and AVOID decisions remain in
  `docs/research/HERMES_OPENCLAW_DECISIONS.md`.

## Active milestone

M0 repository foundation, M1 provider core, M2 deterministic mission runtime, M3 fail-closed tool
runtime, and M4 coding vertical slice are merged and verified in pull-request CI.

M5 implementation and local verification are complete. The original PR #7 checkpoint
`cf0adff3c831ba5ee2ce010ab7fca0523022dc11` was not complete: Actions run `33679627182` failed in
Biome, the branch had no M5 tests, and M4 completion did not consume the verifier. The repaired branch
adds fail-closed evidence/reviewer validation, 16 dedicated verification and M4 gate scenarios, and
requires M5 before M4 can mark tasks verified or enter completion. M5 remains
`PARTIALLY_VERIFIED` until the updated pull-request CI run passes.

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
- Current M5 local gate: `npm run verify` passes with 77 tests, 0 failures, strict TypeScript, Biome,
  foundation validation, and aggregate coverage above configured floors. This is local evidence only;
  the updated PR run is still required.

Provider tests remain injected-transport contracts with synthetic fixtures. M4/M5 integration tests
remain scripted-provider, in-memory event/audit, and injected workspace/quality contracts. CI performs
no live provider call, network tool action, production repository mutation, deployment, or paid action.

## Implemented M5 behavior

- Claims, evidence, bindings, verifier findings, reviewer findings, repair requests, and aggregate
  gate outcomes are distinct typed contracts.
- Evidence is bounded and checked for canonical timestamps, allowlisted kinds/producers/statuses,
  SHA-256 metadata, mission/task scope, freshness, ordering, required kind, pass status, uniqueness,
  missing references, and contradictions.
- Identical normalized inputs produce deterministically ordered findings, satisfied claim IDs, and
  SHA-256 result hashes.
- The built-in adversarial reviewer independently detects cross-task reuse, weak/self-authored
  evidence, stale/pre-change observations, and conflicts.
- Reviewer failures and malformed scope/findings/verdict/repair/hash output become typed `BLOCK`
  results. Repair requests are bounded data and cannot execute tools or mutate state.
- M4 performs a fresh scoped post-change read, maps every persisted definition of done to evidence,
  and requires verifier `PASS`, reviewer `ACCEPT`, and aggregate `PASS` before task verification and
  completion. `BLOCK`, `REPAIR_REQUIRED`, or verifier failure transitions the mission to `BLOCKED`.

## Decisions

- Preserve the strict TypeScript modular monolith; M5 adds a domain boundary, not a service.
- Planner/runtime assertions remain claims, never facts. Independent deterministic tool observations
  are the current strongest accepted evidence class.
- Canonical UTC timestamps and bounded collections reduce ambiguous parsing and denial-of-service
  surface. Unknown kinds or malformed metadata fail closed.
- Verification and review store concise reasons, IDs, and hashes, not raw tool output or private
  reasoning.
- M5 does not own M2 transitions. It returns a gate result; the coding orchestrator owns the guarded
  transition to `BLOCKED` or the existing checkpoint/final-audit path.
- A green quality command is necessary but cannot alone produce `COMPLETED`.

## Open risks

- Updated M5 pull-request CI has not yet supplied the required remote checkpoint.
- Provider adapters have not been exercised in an opt-in live end-to-end smoke test.
- Repository workspace and quality adapters remain injected seams; production sandboxing,
  canonical-root/symlink enforcement, process isolation, CPU/memory/output limits, and worker leases
  are not implemented.
- Mission events, checkpoints, tool audit records, and verification results are not backed by
  SQLite/PostgreSQL durability or an artifact store.
- A blocked M5 evidence package cannot yet be recollected and resumed automatically; the bounded
  request is exposed for a later controller/repair workflow.
- External network/browser/email/payment/deployment tools remain denied and unimplemented.
- Full skill package installation/promotion remains M10 work.
- Branch protection and required-check repository settings remain outside this code checkpoint.

## Exact next action

Push the repaired M5 checkpoint to the existing PR #7 and observe its full Actions result. If green,
record the run/commit/coverage evidence, mark M5 verified, run the documentation-only checkpoint, and
observe that final CI result. Only then begin an M6 task contract for working/project memory, source
precedence, structured session snapshots, context priorities, and deterministic context compilation.
