# G–I: usable Chathub, execution modes, evidence

Scope approved 2026-09-07: repair defects, connect interactive chat to Odin, implement Coding,
Thinking, Research and Ultra, test the integrated product, and report real benchmark evidence.

## Delivery checklist

### G — durable interactive Chathub
- [ ] Authenticated HTTP service and bounded durable conversations over canonical M2/M8 missions.
- [ ] Live event replay, reconnect, conversation history, pause/resume/cancel and steering.
- [ ] Responsive chat, activity, plan, source, change and preview views without fixture results.
- [ ] Build packages the actual web assets; server restart retains history and pauses interrupted work.

### H — executable modes and adapters
- [ ] Server-owned mode policy changes reasoning effort, tool scope, verification and compute ceilings.
- [ ] Thinking supports bounded computation and critique; Research retrieves attributed sources.
- [ ] Coding reads and edits a configured workspace through M3 and runs configured quality checks.
- [ ] Ultra performs bounded plan, execute, independent review and repair within the configured budget.
- [ ] Provider credentials stay server-side; unavailable capabilities fail visibly.

### I — verification and honest measurement
- [ ] Regression coverage for lifecycle races, idempotency, persistence, budgets, scopes and errors.
- [ ] Full `npm run verify`, build and actual browser interactions on desktop and mobile.
- [ ] Preserve both acquisitions from Kimi run 34101485590 with source/head/profile identity.
- [ ] Separate the M16 protocol comparison from a genuine model-alone versus model-plus-Odin runner.
- [ ] Keep unrun live benchmark domains and real production isolation/deployment gates open.

## Invariants and risks

Use M2/M8 canonical mission state, M3 tool authority, M5 evidence acceptance and M12 workspace boundaries.
No fixture may be exposed as a live answer. Model self-review is fallible and cannot prove factual
correctness. Existing historical measurements cannot validate newly written orchestration. Context,
calls, tool outputs and event storage are bounded. Runtime-owned permissions cannot be raised by mode
selection, model output or a steering message. Explicit host execution configuration is a trusted local
operator option, not container isolation. No paid resources are introduced. The user additionally authorized Neon Auth, RLS and a Vercel preview.

## Current evidence boundary

Code is implemented; hosted end-to-end and new live model results are pending. See
`docs/CHATHUB_DEPLOYMENT.md` for explicit limitations and required environment values. Migrations
were applied only to the isolated Neon preview branch. The SQL role checks passed on all eight
application tables. Exactly these G/H/I phases form this delivery block.

## Verification strategy

Test the real HTTP/SQLite/agent loop against injected provider and research transports, actual disposable
workspace edits and registered test commands. Exercise cancellation during generation/tool work,
reconnection, stale versions, duplicate sends, changed idempotency replays, restart recovery, unavailable
providers, forged tool names, research source provenance and failed quality gates. Browser tests exercise
the shipped client against this service. Deterministic tests and live evaluation evidence remain distinct.
