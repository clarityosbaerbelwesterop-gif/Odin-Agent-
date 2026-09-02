# Engineering handover

Updated: 2026-09-02.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- Default branch baseline: `main` at `fbc79820b6de36f94289d46df967a173d50e8f37`.
- Work branch: `agent/odin-foundation`; Draft PR #1 is open against `main`.
- The original repository contained only `README.md` with `# Odin-Agent-`.
- The supplied Hermes/OpenClaw project report was read in full before design work. Its derived
  decisions are recorded under `docs/research/HERMES_OPENCLAW_DECISIONS.md` so research observations
  are not confused with Odin's implementation state.

## Active milestone

M0 repository foundation, M1 provider core, and M2 deterministic mission runtime are implemented and
verified in pull-request CI. M3 tool runtime is next. Odin still does not claim a production coding
agent, sandboxed tool execution, durable database persistence, mobile client, or hosted service.

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
`bc97c7bc206db00eb641965556a4156094ec79a7`. The full suite contains 41 passing tests and 0 failures.
Aggregate coverage is 84.58% lines, 72.80% branches, and 90.91% functions. M2 specifically covers the
closed mission state machine, pause/resume/cancel, task DAG ordering, budget rejection, equivalent-
failure circuit breaking, optimistic event append, idempotent replay, checkpoint integrity, and
interruption/recovery continuation.

## Decisions

- Start as a TypeScript strict modular monolith on Node.js 24; split deployments only for proven
  isolation or scaling needs.
- Use append-only mission events plus projections/checkpoints; chat is not canonical state.
- Keep provider-specific behavior behind adapters and use injected transports for zero-cost tests.
- Unknown model capabilities fail closed; capability, routing, and price records require provenance.
- Provider adapters expose typed retry hints but do not retry or select fallback models themselves.
- Runtime transitions, budgets, cancellation, and anti-loop decisions remain deterministic and outside
  model control.
- The M2 event-store contract is verified with an in-memory adapter. Durable SQLite/PostgreSQL remains
  deliberately unclaimed until its later persistence milestone.
- Make sandboxing, network denial, capability checks, and secret isolation defaults.
- Deliver the coding workflow as the first vertical product slice before mobile breadth or a large
  skill marketplace.

## Open risks

- Provider adapters have not yet been exercised against live APIs; protocol compatibility is based
  on primary documentation and synthetic contract fixtures.
- Tool execution, sandboxing, capability grants, repository mutation, and tool audit are not yet
  implemented; these belong to M3.
- Mission events are not yet backed by durable SQLite/PostgreSQL storage.
- The initial branch has no protection; merge policy and required checks remain repository settings.
- Managed sandbox selection and the web stack remain deliberately undecided until their milestones
  supply concrete requirements.

## Exact next action

Create the M3 task contract, then implement a progressively discoverable tool registry, strict schema
validation, risk classes, scoped capability policy, idempotency, timeout/retry ownership, append-only
tool audit records, and repository read/search/patch/quality-command boundaries without exposing host
execution or unrestricted network access by default.
