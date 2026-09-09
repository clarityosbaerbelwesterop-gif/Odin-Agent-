# G–I: usable Chathub, execution modes, evidence

Scope approved 2026-09-07: repair defects, connect interactive chat to Odin, implement Coding,
Thinking, Research and Ultra, test the integrated product, and report real benchmark evidence.

## Delivery checklist

### G — durable interactive Chathub
- [x] Authenticated HTTP service and bounded durable conversations over canonical M2/M8 missions.
- [x] Live event replay, reconnect, conversation history, pause/resume/cancel and steering.
- [x] Responsive chat, activity, plan, source, change and preview views without fixture results.
- [x] Build packages the actual web assets; server restart retains history and pauses interrupted work.

### H — executable modes and adapters
- [x] Server-owned mode policy changes reasoning effort, tool scope, verification and compute ceilings.
- [x] Thinking supports bounded computation and critique; Research retrieves attributed sources.
- [x] Coding reads and edits a configured workspace through M3 and runs configured quality checks.
- [x] Ultra performs bounded plan, execute, independent review and repair within the configured budget.
- [x] Provider credentials stay server-side; unavailable capabilities fail visibly.

### I — verification and honest measurement
- [x] Regression coverage for lifecycle races, idempotency, persistence, budgets, scopes and errors.
- [x] Full `npm run verify`, build and an actual hosted desktop-browser acceptance pass.
- [ ] Complete an actual mobile/iPad/Safari acceptance pass; deterministic responsive tests are not relabeled as device evidence.
- [x] Preserve both acquisitions from Kimi run 34101485590 with source/head/profile identity.
- [x] Separate the M16 protocol comparison from a genuine model-alone versus model-plus-Odin runner.
- [x] Keep unrun live benchmark domains and real production isolation/deployment gates explicitly open.

## Invariants and risks

Use M2/M8 canonical mission state, M3 tool authority, M5 evidence acceptance and M12 workspace boundaries.
No fixture may be exposed as a live answer. Model self-review is fallible and cannot prove factual
correctness. Existing historical measurements cannot validate newly written orchestration. Context,
calls, tool outputs and event storage are bounded. Runtime-owned permissions cannot be raised by mode
selection, model output or a steering message. Explicit host execution configuration is a trusted local
operator option, not container isolation. No paid resources are introduced. The user additionally authorized Neon Auth, RLS and a Vercel preview.

## Current evidence boundary

The G/H implementation is complete at the repository level. Current exact-head commit
`40c6ba4c2097cc2bc6ad6606bfe528d3532e629c` passed CI run `34322374078`, including full
`npm run verify`, strict TypeScript, Biome, deterministic tests, UI/deployment tests, dry provider smoke
and the production build. The same commit reached `READY` on Vercel preview deployment
`dpl_Du5imBV7aXaLBH115caAbbWoxwbw` in `fra1`. Its Vercel build completed without the former `TS2688`
Node type-definition failure and without the former future-major Node engine warning because the runtime
engine is now pinned to Node 24.x.

The Vercel function boundary uses `api/index.mjs`, which imports the already typechecked
`dist/src/chat/hosted.js` artifact instead of triggering a second isolated TypeScript-function
compilation. The latest preview build therefore exercises the same compiled artifact boundary checked by
the repository tests.

Runtime provider-secret synchronization is separated from the Neon/database preview configuration.
Workflow run `34322036524` passed full verification, synchronized only allowlisted runtime provider
credentials present in GitHub Actions, and created preview deployment
`dpl_6Nb6R525TktLqySzDNuVywCZcaPM`, which subsequently reached `READY`. At that run, `NV_API_KEY` was
present and was written as both the canonical NVIDIA key aliases; `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY` were absent and were therefore skipped rather than invented.
`VERCEL_ODIN_TOKEN` and `NEON_API_KEY` remain control-plane credentials and are intentionally never
copied into the application runtime. `FREE_API_KEY` remains excluded until its HTTPS inference endpoint
and exact provider/model identity are verified. Secret values are never written to artifacts or logs.

The latest exact-head Vercel deployment has no warning/error/fatal runtime entries in the inspected
post-deploy window, and the deployed landing returned HTTP 200 with the configured CSP, HSTS,
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `no-store` and
`noindex` headers. This remains protected Preview evidence, not a public-production claim.

Live Neon Auth/RLS evidence and a hosted desktop-browser acceptance pass are preserved separately. The
browser pass did not enter human credentials, submit a model/coding task or cover mobile/iPad/Safari.
The exact-current-head hosted Auth/persistence smoke is manual and defaults to no model-provider call;
it has not been relabeled as passing until it is explicitly dispatched and its artifact is inspected.
Email delivery, production migration/promotion, restricted integration credentials, physical/mobile
acceptance and broader live benchmark domains remain open. See `docs/CHATHUB_DEPLOYMENT.md` for the
operational boundaries.

## Verification strategy

Test the real HTTP/SQLite/agent loop against injected provider and research transports, actual disposable
workspace edits and registered test commands. Exercise cancellation during generation/tool work,
reconnection, stale versions, duplicate sends, changed idempotency replays, restart recovery, unavailable
providers, forged tool names, research source provenance and failed quality gates. Browser tests exercise
the shipped client against this service. Deterministic tests and live evaluation evidence remain distinct.
