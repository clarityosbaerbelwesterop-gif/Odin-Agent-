# Engineering handover

Updated: 2026-09-03.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` contains verified M0–M8 at M8 merge commit
  `ce0fdb0454999218d1d1145f406d5165a225e6a8`.
- Active branch: `agent/m9-client-protocol`; Draft PR #12 targets `main`.
- M9 implementation is verified on implementation head
  `bd25f831e6e1ef8f06829802af648469d9d6eb62` by GitHub Actions run `33773644733`.
- The synchronized M9 documentation checkpoint must receive its own green PR CI before PR #12 is
  considered merge-ready. The current user request authorizes continued implementation, not merge.

## M9 verified capability

M9 adds the first client-facing observation/control boundary in `src/client` plus a static responsive
reference shell in `web`:

- explicit client protocol version with exact bounded request/response decoders and unknown-field
  rejection;
- bounded user-facing mission projections for state/version/objective/focus, tasks, budgets,
  checkpoint version, durable job counts, and verification evidence references;
- exact mission/session capability grants with runtime expiry and read/command scope;
- only `mission.pause`, `mission.resume`, and `mission.cancel` controls, using optimistic mission
  versions and durable mission-event idempotency rather than arbitrary client mutation;
- bootstrap plus paged reconnect over M8 lifecycle cursors and a deterministic client reducer;
- fail-closed replay/tamper/session/mission/version continuity handling while correctly allowing
  non-consecutive numeric lifecycle cursors caused by other missions;
- a framework-free responsive HTML/CSS/JS fixture with mission, task, budget, worker, evidence,
  reconnect, pause/resume, and deliberate cancel-confirmation surfaces;
- one documented protocol strategy for web and later iOS/iPadOS/macOS/Android clients. Device clients
  remain observers/controllers and never become canonical long-running mission state.

M9 is a local contract/UI proof. It does **not** provide a public HTTP service, production auth,
WebSocket/SSE transport, production hosting, push notifications, offline writes, or native binaries.

## M9 evidence

Canonical command:

```bash
npm ci
npm run verify
```

The first complete M9 run `33770457545` reached 159/161 tests and exposed that compiled web-asset
tests resolved `dist/web/index.html` and `dist/web/app.js` while the static fixture had not been staged
into `dist`. The quality gate was preserved. `scripts/copy-web-assets.mjs` plus a deterministic test
build step fixed the root cause.

GitHub Actions run `33773644733` then passed on
`bd25f831e6e1ef8f06829802af648469d9d6eb62` with **161 tests, 161 passes, 0 failures**. Aggregate
coverage is **89.31% lines, 76.56% branches, and 95.41% functions**. Foundation validation, Biome, and
strict TypeScript also passed.

M9 regression coverage includes protocol/version/unknown-field bounds, exact capability scope,
stale-version denial, command idempotency/conflicting replay, pause/resume/cancel state-machine
integration, deterministic reconnect across page chunking and SQLite reopen, duplicate/hash/scope
resync behavior, client-projection privacy assertions, accessible web landmarks, deliberate
cancellation, DOM text rendering, and absence of live transport or persistent browser state.

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
- M8 implementation run `33766277108` with 149 tests; synchronized documentation run `33766944528`;
  merged as `ce0fdb0454999218d1d1145f406d5165a225e6a8`.

CI remains deterministic and uses injected provider/tool/worker boundaries and temporary local SQLite
stores. It performs no live provider call, public network tool write, deployment, production
migration, production repository mutation, or paid action.

## Security and architecture boundaries

- Canonical mission state remains in M2/M8; client state is always a derived projection.
- Client input, IDs, cursors, and UI content are untrusted and are revalidated at runtime boundaries.
- Client projections exclude provider keys, credentials, lease bearer tokens, raw repository content,
  definitions of done, failure signatures, private reasoning, and raw worker exceptions.
- M3 permission checks and M5 evidence-backed completion remain authoritative; M9 cannot bypass them.
- M3 repository path guards still do not prove canonical-root/symlink or OS sandbox isolation.
- M7 logical ownership is still in-process; M8 SQLite durability still does not provide distributed
  cross-host locks or exactly-once external effects.
- Public authentication, tenant/device identity, production CSP/security headers, push delivery, and
  transport security are not implemented by M9.

## Open risks / remaining MVP work

- production worker/process sandbox and real repository/worktree isolation are not implemented;
- live provider end-to-end smoke is not yet proven;
- no public service/auth/realtime transport connects the M9 protocol to a hosted client;
- M6 memory persistence/encryption/retention and artifact byte storage remain future work;
- server/team PostgreSQL or hosted queue durability, cross-host fencing, backups, HA, and load/recovery
  hardening remain future milestones;
- full permissioned skill package lifecycle is M10;
- empirical model routing/caching/concurrency/cost optimization is M11;
- release security/load/recovery hardening, observability, and eval gates are M12.

## Exact next action

Observe one final PR-specific `npm run verify` result on the synchronized M9 documentation head. If it
passes and PR #12 remains mergeable, M9 is merge-ready but must not be merged unless a user request
explicitly authorizes merge at that point. After M9 is merged, branch M10 from the resulting `main`
head and implement progressively loaded, permissioned, independently tested skill packages without
weakening M3 policy or allowing learned/community skills to self-promote.
