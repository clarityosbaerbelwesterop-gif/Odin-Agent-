# Engineering handover

Updated: 2026-09-02.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` contains the verified M0–M2 squash merge at
  `933f21f73665d50addf781f89b1a8a32861e2ef7`.
- Work branch: `agent/m3-tool-runtime`; Draft PR #3 is open against `main`.
- The original repository contained only `README.md` with `# Odin-Agent-`.
- The supplied Hermes/OpenClaw project report was read in full before design work. Its derived
  decisions are recorded under `docs/research/HERMES_OPENCLAW_DECISIONS.md` so research observations
  are not confused with Odin's implementation state.

## Active milestone

M0 repository foundation, M1 provider core, M2 deterministic mission runtime, and M3 fail-closed tool
runtime are implemented and verified in pull-request CI. M4 coding vertical slice is next.

Odin still does not claim a production coding agent, OS-level sandbox, arbitrary shell execution,
external network tools, durable database persistence, mobile client, or hosted service.

## Verified evidence

Canonical verification command:

```bash
npm ci
npm run verify
```

M0 GitHub Actions run `33664864552` passed for commit
`3b2886028abd2f240cc524bc7f7610d4b6558ba5`.

M1 GitHub Actions run `33667957350` passed for commit
`8d4f33c4bee066fc94d924a911aaa4a876a0539b`. Provider protocol behavior is covered with injected
transports and synthetic fixtures only; no live provider request or inference cost is part of CI.

M2 GitHub Actions run `33672695583` passed for commit
`bc97c7bc206db00eb641965556a4156094ec79a7`. The full suite at that checkpoint contained 41 passing
tests and 0 failures with 84.58% line, 72.80% branch, and 90.91% function coverage.

M3 implementation run `33675783522` passed on commit
`832e28fcde62ca803cd58cad6cb3ea91c5ff6a89`: 55 tests passed, 0 failed; Biome and strict TypeScript
passed; aggregate coverage was 85.93% lines, 73.46% branches, and 91.32% functions. M3 specifically
covers progressive tool discovery, strict schema rejection, capability scope/expiry/call ceilings,
high-risk approval, sequential and concurrent idempotency, bounded retry/timeout/cancellation,
secret-safe audit hashing, traversal rejection, repository adapter forwarding, and quality-command
ID enforcement.

The final M3 documentation/export checkpoint passed GitHub Actions run `33676117584` on commit
`402b0834d83183c4c307bc6d20adb481e5065a68`. M3 is therefore `VERIFIED`.

During M3 verification, CI found and forced fixes for formatter/type errors and one audit-privacy bug
where a resolved repository path was stored in clear text. The regression test remains and the audit
contract now persists a resource hash instead of the raw resource value.

## Decisions

- Start as a TypeScript strict modular monolith on Node.js 24; split deployments only for proven
  isolation or scaling needs.
- Use append-only mission events plus projections/checkpoints; chat is not canonical state.
- Keep provider-specific behavior behind adapters and use injected transports for zero-cost tests.
- Unknown model capabilities fail closed; capability, routing, and price records require provenance.
- Runtime transitions, budgets, cancellation, and anti-loop decisions remain deterministic and outside
  model control.
- The M2 event-store contract is verified with an in-memory adapter. Durable SQLite/PostgreSQL remains
  deliberately unclaimed until its later persistence milestone.
- Tool metadata is progressively discoverable independently from executable handlers.
- M3 capability grants bind mission, task, tool, operation, resource scope, call ceiling, and expiry;
  high-risk execution additionally requires matching approval evidence.
- Side-effecting tools are single-attempt in M3 and require idempotency keys. Concurrent equal-key
  calls serialize before the handler; cross-timeout worker idempotency remains later work.
- M3 repository tools accept scoped operations through injected adapters. Path guards are defense in
  depth, not a sandbox claim, and quality commands are referenced by registered IDs rather than model-
  supplied shell strings.
- Make sandboxing, network denial, capability checks, and secret isolation defaults.
- Deliver the coding workflow as the first vertical product slice before mobile breadth or a large
  skill marketplace.

## Open risks

- Provider adapters have not yet been exercised against live APIs; protocol compatibility is based
  on primary documentation and synthetic contract fixtures.
- Repository workspace and quality-command adapters are injected test seams; production OS sandbox,
  canonical-root/symlink enforcement, and host process isolation are not implemented yet.
- External network/browser/email/payment/deployment tools remain denied and unimplemented.
- Mission events and tool audit records are not yet backed by durable SQLite/PostgreSQL storage.
- Full skill package installation/promotion remains M10 work; M3 implements tool discovery only.
- Branch protection/required-check repository settings remain outside the code checkpoint.

## Exact next action

Create the M4 coding-vertical-slice task contract, then connect the verified M1 provider boundary, M2
mission runtime, and M3 tool gateway in a disposable fixture repository. Prove repository discovery,
plan/task-graph validation, one scoped edit, one deliberately failing quality gate, targeted repair,
rerun to green, and interruption/resume with evidence mapping. Do not claim production sandboxing,
durable database persistence, or live-provider compatibility as part of that fixture slice.
