# Engineering handover

Updated: 2026-09-02.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- Default branch baseline: `main` at `fbc79820b6de36f94289d46df967a173d50e8f37`.
- Work branch: `agent/odin-foundation`; Draft PR #1 is open against `main`.
- The original repository contained only `README.md` with `# Odin-Agent-`.
- No prior code, tests, CI, dependency files, security rules, ADRs, or provider configuration existed.
- The supplied Hermes/OpenClaw project report was read in full before design work. Its derived
  decisions are recorded under `docs/research/HERMES_OPENCLAW_DECISIONS.md` so research observations
  are not confused with Odin's implementation state.

## Active milestone

M1 provider core is implemented and locally verified. M2 mission runtime is next. No functioning
mission orchestrator, tool execution, persistence, or end-to-end coding agent is claimed yet.

## Verified evidence

Local M0 baseline:

```bash
npm ci
npm run verify
```

M0 result on 2026-09-02: dependency installation, foundation validation, Biome, and repository checks
passed. GitHub Actions run `33664864552` completed successfully for commit
`3b2886028abd2f240cc524bc7f7610d4b6558ba5`.

M1 local result on 2026-09-02: 29 provider contract tests passed with no live API calls; aggregate
coverage was 81.60% lines, 88.46% functions, and 68.81% branches. TypeScript and Biome passed.
OpenAI Responses, Anthropic Messages, OpenRouter Chat Completions, NVIDIA NIM Chat Completions, and
an explicitly configured compatible adapter are covered by synthetic request/response tests.

## Decisions

- Start as a TypeScript strict modular monolith on Node.js 24; split deployments only for proven
  isolation or scaling needs.
- Use append-only mission events plus projections/checkpoints; chat is not canonical state.
- Keep provider-specific behavior behind adapters and use injected transports for zero-cost tests.
- Unknown model capabilities fail closed; capability, routing, and price records require provenance.
- Provider adapters expose typed retry hints but do not retry or select fallback models themselves.
- Make sandboxing, network denial, capability checks, and secret isolation defaults.
- Deliver the coding workflow as the first vertical product slice before mobile breadth or a large
  skill marketplace.

## Open risks

- Provider adapters have not yet been exercised against live APIs; protocol compatibility is based
  on primary documentation and synthetic contract fixtures.
- None of the mission, task graph, persistence, scheduler, budget, or tool runtime is implemented.
- The initial branch has no protection; merge policy and required checks remain repository settings.
- Managed sandbox selection, persistence library, and web stack remain deliberately undecided until
  their milestone supplies concrete requirements.

## Exact next action

Create the M2 task contract, then implement the mission aggregate, closed state-transition table,
task DAG validation, deterministic scheduler decisions, budgets, cancellation, append-only events,
checkpoints, and interruption/recovery tests without introducing external calls inside state writes.
