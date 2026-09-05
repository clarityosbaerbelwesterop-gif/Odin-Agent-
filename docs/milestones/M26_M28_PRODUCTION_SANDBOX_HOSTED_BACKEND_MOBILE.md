# M26–M28 — Production sandbox, hosted mission backend, and mobile experience

Status: **IN_PROGRESS**. This is the binding contract for one pull request containing exactly three
sequential milestones. Checked items require repository evidence; architecture names never imply live
infrastructure proof.

## Package objective

Extend the verified M12 sandbox, M2/M8 durable mission runtime, and M9 client protocol toward a
production-shaped service without weakening any existing authority boundary:

1. **M26 Production sandbox** adds a strong-isolation execution contract, runtime-owned resource/network/
   filesystem/secret policy, bounded execution, deterministic cleanup, and secret-safe audit evidence.
2. **M27 Hosted mission backend** adds an authenticated tenant-scoped service kernel over canonical
   mission state, durable queue/workers, artifacts, audit, realtime reconnect, backup/recovery, and
   failure injection through injected infrastructure adapters.
3. **M28 Mobile experience** adds platform-neutral mobile/native experience contracts for mission
   progress, reconnect, approvals, suspension/resume, and read-only offline behavior while canonical
   compute remains server-side.

## Package invariants

- M3 remains the only tool/capability execution authority.
- M5 remains completion/evidence authority.
- M8/M2 canonical mission semantics are not reimplemented by the hosted service.
- M9 client protocol remains the authoritative client-control boundary; M28 may extend UX metadata but
  not create offline mutation authority.
- M12 workspace/network/backend rules remain fail closed. M26 may strengthen but never bypass them.
- Credentials remain control-plane-only. Models/clients/workers receive opaque references or scoped
  brokered material only where an adapter contract explicitly requires it.
- Tenant/user/project/mission scope is explicit at every hosted boundary.
- Side effects remain idempotent, fenced where applicable, cancellable, bounded, and auditable.
- Local/injected fixture evidence cannot be relabeled as a live hosted/container/VM/public-service proof.
- No paid resource, deployment, production migration, billing change, public traffic, or new external
  credential use is authorized by this package.

## M26 — Production sandbox

Goal: make production-grade isolation a runtime-enforced backend requirement and bind every execution to
exact scope, resource ceilings, secret policy, cleanup, and audit evidence.

### Required repository-local implementation

- [ ] Define strong isolation classes (`container`, `microvm`, `vm`) separately from the existing
  `host_process` / generic provider-managed M12 labels.
- [ ] Require an integrity-bound runtime attestation for the exact sandbox backend policy version and
  isolation class before a backend is considered production-eligible.
- [ ] Bind session identity to mission/task/backend/policy/isolation and reject stale/tampered/foreign
  session or attestation replay.
- [ ] Define runtime-owned CPU, memory, process, wall-time, output, filesystem-write, and network-request
  quotas with bounded validation.
- [ ] Bind filesystem scope to explicit workspace roots and network scope to M12-approved destinations;
  sandbox adapters cannot widen either scope.
- [ ] Add an opaque secret broker contract: model/client payloads expose references only, broker release is
  task/session scoped and expiring, and audit evidence never persists secret values.
- [ ] Require deterministic cleanup for every production session; cancellation/timeout/failure must enter
  cleanup and released sessions cannot be reused.
- [ ] Emit bounded secret-safe audit records for allocate/execute/cleanup decisions and resource usage.
- [ ] Add adversarial tests for policy downgrade, isolation relabeling, quota bypass, stale session,
  secret-reference confusion, cleanup replay/conflict, and audit secret leakage.

### External proof gate

- [ ] Execute one real container/microVM/VM backend through the production adapter and preserve
  independently attributable isolation/cleanup evidence.

Repository-local completion may be **CONTRACT_VERIFIED** while this external gate remains open; it must
not be described as live production isolation.

## M27 — Hosted mission backend

Goal: expose the existing canonical runtime through a tenant-safe hosted-service boundary while keeping
persistence/queue/auth/realtime providers replaceable.

### Required repository-local implementation

- [ ] Define strict hosted identity/session/tenant/project/mission scope contracts and an injected
  authentication resolver; missing/expired/foreign sessions fail closed.
- [ ] Define injected durable mission, queue/worker, artifact, audit, realtime, and backup adapters rather
  than hard-coding a cloud vendor.
- [ ] Reuse M8 mission/job semantics for versions, idempotency, attempts, lease generations, fencing,
  cancellation, and lifecycle cursors instead of creating parallel semantics.
- [ ] Add tenant-scoped artifact metadata with hash/size/content-type bounds and deny cross-tenant/
  cross-mission lookup.
- [ ] Add authenticated bootstrap/reconnect over canonical mission projection + lifecycle cursor with
  bounded pages and resync on continuity failure.
- [ ] Add hosted command handling that preserves M9 expected-version/capability/idempotency rules.
- [ ] Add secret-safe append-only hosted audit events for auth, reads, commands, queue claims,
  artifact access, backup, recovery, and denials.
- [ ] Add deterministic backup/recovery evidence bound to exact tenant/mission state identity.
- [ ] Add injected failure scenarios for database unavailable, queue lease expiry, worker crash,
  artifact unavailable/corrupt, realtime disconnect, stale command, and backup/restore mismatch.
- [ ] Prove repository-local adapters recover or fail closed without inventing successful public-service
  availability.

### External proof gate

- [ ] Exercise the hosted service against an authorized durable database/queue/auth/realtime deployment,
  including backup/restore and worker recovery, before any public traffic claim.

Repository-local completion may be **CONTRACT_VERIFIED** while this external gate remains open.

## M28 — Mobile experience

Goal: make Odin operable from phones/tablets/native shells without moving canonical long-running work or
security authority onto devices.

- [ ] Define supported platform classes for responsive web, iOS, iPadOS, Android, macOS, and desktop web.
- [ ] Define bounded device/session experience metadata without device identifiers becoming auth
  authority.
- [ ] Define mission progress, task, budget, verification, worker/activity, and reconnect presentation
  contracts using M9 bounded projections only.
- [ ] Define approval cards for high-impact actions that require a fresh server-issued approval challenge,
  exact mission/task/action/version binding, expiry, and explicit user decision.
- [ ] Define suspension/background behavior: long-running compute stays server-side; client resume begins
  from a durable cursor or full bootstrap.
- [ ] Define offline behavior as read-only bounded cached presentation; no offline command or approval may
  later replay as authorized without fresh server validation.
- [ ] Define notification hints as non-authoritative metadata; a push/open event never proves mission state.
- [ ] Add deterministic tests across all platform classes for reconnect gaps, stale cached state, expired
  approvals, cross-mission confusion, suspension/resume, and offline mutation denial.
- [ ] Provide/update a responsive web reference fixture that demonstrates mission progress, reconnect,
  and approval UX without storing credentials or canonical state in browser persistence.

M28 does not require shipping App Store/Play Store/native binaries in this package. Native shells must
consume the same versioned protocol and authority model when implemented.

## Verification sequence

For each milestone:

1. implement smallest coherent runtime slice;
2. add requirement-derived and adversarial tests;
3. run full repository `npm run verify` in CI;
4. repair failures before starting the next milestone;
5. record exact evidence without overclaiming live infrastructure.

After M28: perform package-wide adversarial review, synchronize `ROADMAP.md`, `HANDOVER.md`,
`ARCHITECTURE.md`, and `SECURITY.md`, obtain one final normal exact-head CI, and leave merge separately
approval-gated.

## Explicit non-goals

- No new cloud/vendor lock-in.
- No direct model access to Docker/Kubernetes/VM APIs, raw credentials, database connections, or queues.
- No public endpoint, public traffic, production migration, paid sandbox, hosted database, or billing
  change without separate user authorization.
- No local-host process may be relabeled as container/microVM/VM isolation.
- No SQLite fixture may be relabeled as distributed/hosted durability.
- No static/mobile fixture may be relabeled as a shipped native app.
- No synthetic or injected test may create M5 completion, M11 quality, M12 live release, or production
  availability evidence by itself.
