# Engineering handover

Updated: 2026-09-02.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` contains the verified M0–M3 squash merge at
  `0a9a76bc7ce2b52e8e879d81d3b261a8168efb29`.
- Work branch: `agent/m4-coding-vertical-slice`; Draft PR #5 targets `main`.
- The supplied Hermes/OpenClaw project report was read in full before design work. Its derived
  decisions remain recorded under `docs/research/HERMES_OPENCLAW_DECISIONS.md`.

## Active milestone

M0 repository foundation, M1 provider core, M2 deterministic mission runtime, M3 fail-closed tool
runtime, and the M4 coding vertical slice are implemented and verified in pull-request CI. M5
independent verification and adversarial review is next after M4 is merged.

Odin still does not claim a production coding agent, OS-level sandbox, arbitrary shell execution,
external network tools, durable database persistence, live-provider end-to-end compatibility, mobile
client, or hosted service.

## Verified evidence

Canonical verification command:

```bash
npm ci
npm run verify
```

M0 GitHub Actions run `33664864552` passed for commit
`3b2886028abd2f240cc524bc7f7610d4b6558ba5`.

M1 GitHub Actions run `33667957350` passed for commit
`8d4f33c4bee066fc94d924a911aaa4a876a0539b`. Provider behavior is contract-tested with injected
transports and synthetic fixtures; no live provider request or inference cost is part of CI.

M2 GitHub Actions run `33672695583` passed for commit
`bc97c7bc206db00eb641965556a4156094ec79a7`. That checkpoint contained 41 passing tests with 84.58%
line, 72.80% branch, and 90.91% function coverage.

M3 implementation run `33675783522` passed with 55 tests, 0 failures, strict TypeScript and Biome
green, and 85.93% line / 73.46% branch / 91.32% function coverage. M3 was merged to `main` at
`0a9a76bc7ce2b52e8e879d81d3b261a8168efb29` after the final PR gate also passed.

M4 implementation run `33678970596` passed on commit
`97aafde51f54d370dddcc3b228d340a589d994bf`:

- 61 tests passed, 0 failed;
- Biome passed;
- strict TypeScript passed;
- aggregate coverage: 87.25% lines, 72.68% branches, 93.14% functions;
- `src/runtime/coding.ts`: 93.55% line, 73.58% branch, 95.45% function coverage;
- `src/runtime/coding-contract.ts`: 88.98% line, 62.37% branch, 100% function coverage.

M4 proves a full scripted-provider fixture flow: bounded repository discovery, strict plan validation,
M2 task creation, scoped M3 patch, deliberate quality failure, bounded repair, green rerun,
evidence-backed completion, and fresh-runtime resume from replayed mission state. Regression tests
also prove malformed plans fail before writes, arbitrary command text cannot become a quality
execution, missing capabilities deny before adapter mutation, and a still-failing required gate reaches
`FAILED` rather than `COMPLETED`.

## Decisions

- Keep the first production architecture a strict TypeScript modular monolith on Node.js 24.
- Mission state, budgets, cancellation, retries, failure bounds, and completion remain deterministic
  runtime responsibilities rather than model authority.
- Provider-specific payloads stop at M1 adapters; M4 consumes only `ModelProvider` contracts.
- M4 bootstrap discovery is runtime-owned and passes through M3 controls. Only after strict plan
  validation is the canonical M2 mission/task graph created.
- Runtime-owned definition-of-done markers persist the selected changed file and registered quality
  command inside replayable M2 state. Model output cannot supply these reserved markers.
- All mission-phase reads, writes, and quality runs pass through M3 capability, schema, idempotency,
  timeout, and audit controls.
- Model token usage, tool calls, and attempts are accounted into M2 mission budgets.
- Required quality gates own completion: a red gate cannot reach `COMPLETED`.
- The current event store, audit sink, scripted provider, workspace, and quality runner are contract
  fixtures. They deliberately do not imply durable storage, live-provider compatibility, or OS-level
  isolation.

## Open risks

- Provider adapters have not yet been exercised in an opt-in live end-to-end smoke test.
- Repository workspace and quality-command adapters remain injected seams; production sandboxing,
  canonical-root/symlink enforcement, process isolation, CPU/memory/output limits, and worker leases
  are not implemented.
- Mission events, checkpoints, and tool audit records are not backed by SQLite/PostgreSQL durability.
- External network/browser/email/payment/deployment tools remain denied and unimplemented.
- M4 has workflow-level evidence mapping but not yet an independent M5 verifier/adversarial reviewer.
- Full skill package installation/promotion remains M10 work.
- Branch protection and required-check repository settings remain outside the code checkpoint.

## Exact next action

After the final M4 documentation/PR CI checkpoint and merge, create an M5 branch and task contract.
Implement an independent verification engine that consumes declared definitions of done and collected
evidence without trusting planner self-assessment, plus an adversarial review pass that can block
completion or request bounded targeted repair. Preserve the M4 no-live-cost fixture strategy while
adding regression cases for false-positive completion, stale evidence, verifier disagreement, and
review-triggered repair.
