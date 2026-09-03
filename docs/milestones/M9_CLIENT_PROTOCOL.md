# M9 — Client protocol and responsive web contract

Status: VERIFIED. Updated: 2026-09-03.

## Objective

Build Odin's first user-facing control/observation boundary without moving mission authority into a
browser or native client. Define one versioned protocol that can serve the responsive web client now
and later native iOS/iPadOS/macOS/Android clients. Prove reconnect from M8 canonical state and cursors,
strict command validation, stale-command rejection, and deterministic client projection.

M9 is a protocol/UI milestone. It does not add a hosted service, public authentication system, native
app binaries, remote worker RPC, live provider execution, or production deployment.

## Milestone slices

1. Versioned client protocol: mission projection, lifecycle/event envelopes, reconnect cursor,
   capability/command contracts, bounded errors, protocol-version negotiation, and fail-closed codecs.
2. Controller gateway: injected mission/job query and command authorities; optimistic expected-version
   commands; explicit pause/resume/cancel only; no direct event append, worker settlement, tool call,
   verifier bypass, or arbitrary state mutation.
3. Reconnect/session projection: bootstrap snapshot plus cursor, bounded incremental events, duplicate
   suppression, continuity checks, stale snapshot/event rejection, and deterministic reducer state.
4. Responsive web shell: framework-free static HTML/CSS/JS served only as an M9 fixture/client asset;
   desktop/tablet/mobile layouts for mission status, task progress, budgets, durable worker activity,
   evidence status, reconnect state, and safe controls.
5. Native strategy: native clients consume the same protocol and never host canonical long-running
   state; no native executable is claimed in M9.

## Acceptance criteria

### Protocol boundary

- Protocol version is explicit and validated. Unknown major versions fail closed; bounded compatible
  minor versions may be negotiated only by runtime-owned policy.
- Every envelope has stable request/session/mission identity, canonical UTC timestamp, protocol
  version, and bounded payload. Unknown fields or event/command types fail closed.
- Mission projections are derived from M2/M8 state and expose only user-facing data required by the
  client: mission state/version/objective/focus, task statuses, budget limits/usage, checkpoint/event
  position, durable job counts/activity, and verification/evidence references where available.
- No private chain of thought, raw credentials, provider keys, raw repository contents, raw worker
  errors, lease bearer tokens, or hidden policy internals enter the protocol.

### Controller commands

- Initial M9 commands are `mission.pause`, `mission.resume`, and `mission.cancel` only.
- Commands require exact mission scope, expected mission version, unique idempotency key, canonical
  timestamp, and a runtime-issued capability declaration. Missing/stale/foreign/replayed/conflicting
  commands fail closed before mutation.
- The gateway delegates only to injected runtime authorities. It cannot append arbitrary mission
  events, settle durable jobs, call tools/models, mark tasks verified, or complete a mission.
- Command results return the resulting canonical projection plus typed outcome/error metadata.

### Reconnect semantics

- Bootstrap returns one validated projection plus the latest durable lifecycle cursor known for that
  mission and a bounded event page.
- Incremental reconnect uses strict `afterCursor` chaining. Duplicate pages are idempotently ignored;
  moving the requested cursor ahead of the accepted client cursor, foreign missions/sessions, changed
  hashes, or incompatible protocol versions require a fresh bootstrap.
- M8 lifecycle cursors are global while reads are mission-scoped, so numeric cursor values for one
  mission do not have to be consecutive. Integrity is established by strict request/response chaining,
  monotonic delivered events, exact scope, and event hashes rather than `cursor + 1` arithmetic.
- A fresh client reducer receiving the same bootstrap/events reaches the same state independent of
  transport chunking. Client cache/state never becomes canonical mission truth.
- Offline mutation is out of scope: a disconnected client may queue UI intent locally only in later
  work; M9 does not claim conflict-free offline writes.

### Responsive web shell

- Use semantic accessible HTML and responsive CSS with no runtime framework dependency added solely
  for M9. The shell remains usable at phone, tablet, and desktop widths.
- Visible surfaces: mission header/state, task list, budget usage, durable worker counts/activity,
  verification/evidence summary, reconnect status/cursor, and explicit pause/resume/cancel controls.
- Dangerous controls are visually distinct, require a deliberate confirmation interaction in the
  fixture UI, and never infer approval from model/tool content.
- The static shell consumes fixture protocol data in tests/demo assets only. It does not claim a live
  backend, authentication, WebSocket/SSE connection, deployment, or native wrapper.

## Security invariants

- Client input is untrusted. The server/runtime revalidates every command and expected version.
- A client can observe/control only a mission explicitly in its injected capability scope.
- Protocol identifiers are opaque bounded values; never encode secrets in IDs, cursors, query strings,
  logs, or persisted browser storage.
- Reconnect events are integrity checked before projection. A client never skips malformed/tampered
  canonical data and continues silently.
- UI rendering uses text content and DOM construction, not unsanitized HTML from mission/tool/model
  data.
- M3 permission checks and M5 completion evidence remain authoritative; M9 cannot weaken or replace
  them.

## Verification evidence

Deterministic verification uses in-memory/injected gateway fixtures plus temporary M8 SQLite stores.
The required suite covers protocol codec/version/unknown-field/size/timestamp rejection, exact-scope
capabilities, stale expected versions, idempotency conflicts, pause/resume/cancel state-machine
integration, reopen/reconnect, deterministic reducer paging, duplicate/tamper/scope failures, privacy,
and static web accessibility/safe-rendering assertions.

An initial implementation checkpoint exposed two real failures: the compiled web-asset tests resolved
assets below `dist/web`, but the static fixture was not staged there. The gate was not weakened. A
small deterministic asset-copy step was added to the test build path and the same tests were rerun.

GitHub Actions run `33773644733` passed on implementation head
`bd25f831e6e1ef8f06829802af648469d9d6eb62` with **161 tests, 161 passes, 0 failures**. Aggregate
coverage was **89.31% lines, 76.56% branches, and 95.41% functions**. Foundation verification, Biome,
and strict TypeScript also passed.

## Out of scope

- Public HTTP server/API deployment, OAuth/session authentication, tenant/device administration.
- WebSocket/SSE transport implementation, push notifications, background mobile execution.
- Native iOS/iPadOS/macOS/Android application binaries or app-store packaging.
- Offline writes/conflict resolution, collaborative multi-user editing, presence.
- Production browser sandbox/security headers/CSP hosting configuration.
- Live provider calls, network tools, production repository mutation, deployment, paid resources.
