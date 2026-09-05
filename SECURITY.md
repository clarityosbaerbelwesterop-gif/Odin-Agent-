# Security model

Status: deterministic safeguards through M25 are implemented or governance-synchronized on PR #33.
M0–M22 are merged on `main`; M23–M25 await one fresh exact-head CI before merge. M12 remains
**PARTIALLY_VERIFIED** for real hosted-sandbox/public-production isolation. Controls not explicitly
identified as implemented remain future work and must not be inferred from names or fixture evidence.

## Protected assets

- provider and integration credentials;
- user repositories, documents, memory, artifacts, and personal data;
- mission integrity, budgets, approvals, durable events, checkpoints, job state, and audit history;
- execution hosts, network access, connected devices, external accounts, and side effects;
- system-protected policy, skills, capability packs, routing/evaluation records, sandbox sessions,
  release evidence, and tool manifests.

## Trust boundaries

Trusted: the minimal control plane, policy engine, secret broker, validated runtime protocol handlers,
canonical persistence, registered M3 manifests/handlers, configured sandbox backends, and independent
verification authorities.

Untrusted by default: user/client input, web/email/chat content, repositories under analysis, dependency
metadata, model output, tool output, community skills/plugins, generated code, browsers, workers, memory
content, compression proposals, capability-pack selection requests, and ecosystem adapter descriptors.
An instruction embedded in untrusted content never becomes runtime authority.

## Default policy

```yaml
filesystem: task-workspace-only
network: deny
secrets: deny-direct-access
host-execution: deny
privileged-execution: deny
external-write: require-scoped-grant
high-impact-action: require-explicit-approval
```

Denial is the fallback for malformed, missing, stale, foreign, ambiguous, or conflicting policy data.
A model, worker, skill, client, memory record, or adapter cannot mint authority merely by returning a
capability-shaped object.

## Credential and secret handling

Long-lived credentials reside only in a protected credential store. Models, clients, memory, skill
instructions, and ordinary workers receive neither raw keys nor a general-purpose secret environment.
The control plane resolves the narrowest configured credential only after exact identity/policy checks.

Redaction/secret rejection occurs before sensitive values can enter logs, events, artifacts, errors,
memory, client payloads, evaluation evidence, or model context. The committed `.env.example` contains
names and blank values only; real environment files remain ignored.

M12 sandbox credentials use runtime-owned opaque `credentialRef`s. Public/session metadata may expose
that a credential is required, but never the underlying reference or value. M24 compression additionally
rejects obvious secret-like input and cannot lower source sensitivity.

## Authority matrix

- **M2/M8** own canonical mission lifecycle and durable orchestration state.
- **M3** owns tool registration, grants, approvals, schema enforcement, side-effect/idempotency policy,
  timeout/retry/cancellation, handler dispatch, and audit.
- **M5** owns completion/evidence acceptance.
- **M6** owns scoped memory contracts; memory remains lower authority than current evidence.
- **M10** owns skill verification, activation, supersession, rollback, and revocation.
- **M11** owns empirical quality-floor-preserving model routing.
- **M12** owns current workspace/process/network/sandbox lifecycle and release-proof boundaries.
- **M15** owns measured evidence required for community capability-pack membership.
- **M23** may select/load already-eligible capability packs but cannot alter M10/M15 authority.
- **M24** may retrieve/maintain lower-authority memory but cannot relabel it as current evidence.
- **M25** may catalog registered M3 tools but cannot execute outside M3 or weaken its manifests.

No later layer may silently duplicate or bypass an earlier authority boundary.

## Implemented M3 tool safeguards

Model-proposed tool calls are untrusted. `src/tools` validates exact tool/version identity and strict
input schemas before policy or handler execution. Capability grants bind mission/task/tool/operation/
resource scope, call ceiling, and expiry. High-impact actions require matching unexpired approval.

Side-effecting calls require idempotency keys. Matching replay returns the prior result; changed replay
under the same key fails. Handler attempts are bounded by timeout/cancellation and capability-call
ceilings. Audit records retain bounded typed metadata/hashes rather than raw sensitive payloads.

Built-in repository operations accept normalized workspace-relative paths and stable quality-command
IDs. Arbitrary model-provided shell strings or network destinations are not accepted.

## Implemented M5 verification safeguards

Planner/runtime/model assertions are not completion authority. M5 validates bounded typed evidence,
canonical timestamps, allowlisted producers/kinds/statuses, exact mission/task scope, hashes, freshness,
and coverage. Missing, stale, future, foreign, failed, duplicated, contradictory, malformed, weak, or
self-authored evidence fails closed.

A separate adversarial reviewer is non-mutating and may ACCEPT, BLOCK, or request bounded repair.
Malformed review output or reviewer failure blocks. Stored decisions use concise evidence references and
hashes rather than hidden reasoning.

## Implemented M6/M18/M24 memory and context safeguards

M6 isolates records by exact user/project scope, with exact mission scope for working memory. Records
carry hashes, sensitivity, provenance, versions, expiry, and lifecycle state. Durable user preferences
require explicit-user provenance. Optimistic versions reject competing updates; idempotency rejects
changed replay; tombstones remove raw content and prevent resurrection.

Context compilation keeps fixed source priority. Current authoritative repository/runtime/task evidence
wins semantic collisions and mandatory P0–P2 context cannot be optimized away. Sensitive compilations
bypass retained cache. M18 delta/reuse identity binds scope, profile, policy, source identity, and
verification requirements.

M24 adds these fail-closed controls:

- exact user/project scope and deterministic provenance on advanced retrieval;
- future-dated current-source and remembered evidence rejection;
- stale memory is marked/excluded from authoritative selection when current source differs;
- conflicting current project conclusions are surfaced rather than silently tie-broken;
- retention planning is bounded and refuses to claim complete coverage from a saturated retrieval page;
- deletion delegates to exact tombstone semantics;
- compression preserves exact source ids/hashes and strongest sensitivity;
- compression output is lower-authority `model_summary` project memory only;
- secret-like material is rejected;
- a proposal must have been issued by the current runtime instance before commit;
- exact replay is idempotent; tampered or foreign replay fails.

Memory cannot create tools/grants, promote skills, raise budgets, lower routing quality, resolve
credentials, or mark work complete.

## Implemented M7/M8/M20 worker and recovery safeguards

Specialist workers are untrusted proposal producers. M7 reserves logical ownership, bounds concurrency,
validates structured proposals, and requires runtime-attested evidence before reconciliation.

M8 durable jobs use bounded attempts, expiring leases, fencing generations, opaque lease-token hashes,
heartbeat/settlement scope checks, cancellation terminality, and integrity-checked lifecycle events.
Stale generations cannot settle after reclaim. Local SQLite provides at-least-once restart durability,
not cross-host exactly-once semantics.

M20 logical soak observations are hash-chained runtime evidence. Restart checkpoints, recovered lease
generation, cancellation, equivalent-failure ceilings, event shapes, budgets, and synthetic time are
validated fail closed. Synthetic duration never becomes a production-uptime claim.

## Implemented M9 client safeguards

Client protocol input is untrusted and decoded with exact versions/key sets/bounds. Client capabilities
are opaque runtime-resolved identifiers with exact session/mission scope and expiry. State reads require
read authority; commands are limited to explicit pause/resume/cancel controls with expected mission
version and durable idempotency.

Client projections exclude credentials, lease bearer tokens, raw repository contents, private reasoning,
hidden policy, and raw worker exceptions. Reconnect consumes integrity-bound mission-scoped lifecycle
pages. Unsafe continuity requires fresh bootstrap. The current web shell is a static reference client and
is not evidence of public authentication/transport or native-app security.

## Implemented M10/M14/M15/M23 skill safeguards

M10 separates compact discovery from bounded instruction loading. Learned/community packages start as
candidates; content is immutable/hash-addressed; independent passing evidence must match exact content;
activation/rollback require trusted actors. Required tools are declarations only and never create M3
handlers or grants.

M14 treats external skill/plugin snapshots as hostile until bounded non-executing intake completes.
Immutable source identity, file/byte/depth bounds, binaries/symlinks, scripts/hooks/workflows/MCP,
prompt override, exfiltration, credential collection, destructive behavior, privilege escalation,
self-promotion, and memory/policy poisoning are considered. Incomplete analysis cannot become safe.
Only COMPLETE+ACCEPT can become an M10 community candidate and intake still grants no execution authority.

M15 requires exact candidate/domain/task-class/procedure identity and independent measured evidence for
community pack membership. Offline replay is proposal-only and receives no mutation authority.

M23 adds runtime Skill OS safeguards:

- discovery exposes only compact eligible pack metadata;
- selection binds exact pack id/version/hash and trusted member/task-class metadata;
- a caller cannot relabel a member to another task class;
- selection freshness is bounded and future/stale/tampered selection fails;
- progressive load re-resolves M10/M15 exact identity and rejects revoked/changed/unloadable content;
- runtime pin/history rollback returns to an observed exact revision only;
- rollback does not activate/promote/verify/revoke or otherwise mutate skill lifecycle.

Skill OS cannot mint M3 authority, M5 evidence, credentials, memory authority, budget, or release claims.

## Implemented M11/M21 routing safeguards

Routing chooses only candidates with required capability and fresh independent empirical quality that
meets the effective floor. Cost/latency optimize only among already-qualified routes. Risk/uncertainty may
raise, never lower, the floor. Branch/critique/repair/escalation/call/token/cost/concurrency ceilings are
runtime-owned.

M21 recent failures are negative evidence bound to exact provider/model/profile/reasoning/task-class/
signature identity. Fresh valid failure may remove only that exact route. It cannot create positive
quality, add capability, resolve credentials, strengthen sandbox scope, or increase budget.

## Implemented M12 execution/sandbox/release safeguards

### Workspace/process

- trusted workspace roots are canonicalized;
- lexical traversal, absolute paths, NUL/backslash ambiguity, prefix confusion, and symlink escape fail;
- writes resolve via the nearest canonical existing parent;
- executable/fixed arguments come from runtime registration, not model shell text;
- subprocess uses `shell: false` and deny-by-default environment;
- timeout, cancellation, stdout/stderr byte ceilings, and runtime concurrency are bounded.

This is a bounded host-process boundary, **not** kernel/container/VM isolation.

### Network

HTTPS is the default. URL credentials/fragments/ambiguous syntax and unauthorized host/port destinations
fail. Loopback/link-local/private/multicast/unspecified/mapped-private/reserved addresses fail. Every
injected DNS answer must satisfy policy and destination changes require a fresh decision. A future real
transport must preserve this decision against unsafe re-resolution before DNS-rebinding resistance can
be claimed end to end.

### Sandbox lifecycle

Exact provider+model+profile identity selects configured backends. Credentials resolve only after exact
binding checks. Create/release use deterministic idempotency identity; identical concurrent operations
collapse, conflicting replay fails, cleanup is mandatory, and released sessions cannot silently revive.
Current proof is provider-neutral/local contract behavior, not a live hosted sandbox.

### Observability/release

`src/observability` rejects dangerous metadata keys and obvious secret-like values before persistence.
`src/release` binds evidence to exact producer/level/subject/status/time/hash and enforces monotonic local,
integration, and live claim policies. Local evidence cannot unlock integration/live claims. Backup/
restore proof binds source/restored state hashes but does not manufacture cloud recovery evidence.

## Implemented M13 learning safeguards

Learning proposals are untrusted and secret-screened. Establishment requires repeated distinct
independently verified mission/task support with exact scope/content/evidence hashes. Competing content
conflicts and cannot become a nudge or M6 entry. Learned memory remains lower authority and cannot create
tools, completion, skill promotion, credentials, budgets, routing quality, or durable user preferences.

## Implemented M16/M17/M19 coding safety

M16 binds surgical exact-edit proposals to runtime-trusted task/path/source/preimage and rejects absent,
ambiguous, stale, no-op, scope-changing, or malformed edits.

M17 classifies bounded failure evidence and denies unsafe retry after unknown/irreversible side effects.
Reversible repair requires trusted preimage evidence; recovery budgets and repeated-strategy signatures
prevent loops.

M19 validates at most 100 canonical workspace-relative targets, exact pre/post hashes, ownership,
dependencies, and forbidden surfaces before mutation. Any partial apply or post-mutation failure restores
runtime-captured preimages before failing closed. The injected workspace contract is not proof of
kernel/filesystem atomicity.

## Implemented M22 evaluation safeguards

Benchmark cases/results are untrusted evidence objects. Hidden acceptance metadata is absent from
model-facing projections. Matched arms require equal provider/model/profile/reasoning/harness/budget
identity and stay inside per-case ceilings. Duplicate/cherry-picked arms fail. Deterministic attributable
task failures remain measurable negative outcomes; timeout/network/auth/rate-limit/unavailable/malformed/
unknown infrastructure ambiguity remains incomplete. Zero complete pairs is INCONCLUSIVE with null lift.
Evaluation output cannot mint M3/M5/M10/M11/M12/release authority.

## Implemented M25 tool-ecosystem safeguards

`src/tools/ecosystem.ts` treats adapter descriptors as untrusted catalog metadata.

- every descriptor references an already-registered exact M3 tool name/version;
- operation, risk, side-effect, timeout, retry, and trust fields must mirror the M3 manifest;
- category is one of repository/browser/database/cloud/documents/data/CI-CD/API/research;
- cost/network/credential/confirmation declarations cannot weaken M3 policy;
- duplicate identity, unknown tool/category, descriptor/manifest mismatch, or unsafe confirmation fails;
- side-effecting execution requires idempotency as M3 already requires;
- full schema resolves from M3 only when needed;
- execution delegates only to `ToolRuntime.execute`, preserving grants, approvals, timeout/retry,
  cancellation, idempotency, handler dispatch, and audit.

No current M25 fixture proves a real browser/database/cloud/API connection and none authorizes one.

## Prompt injection and untrusted-content rules

Every context item carries origin/trust metadata. External content, repository text, skill instructions,
tool output, memory, and model output are data unless the trusted runtime explicitly interprets a
validated field. Untrusted observations cannot modify protected policy, credentials, sandbox bindings,
skill lifecycle, durable user preferences, routing floors, budgets, or completion authority.

## Audit and privacy

Consequential records should retain initiator, mission/task, action type, input hash, policy decision,
result, side-effect summary, verification, and timestamp without private chain-of-thought. Durable job,
client, skill, memory, and tool records use typed reason/status codes, hashes, timestamps, and references
rather than secrets, raw environments, raw exceptions, or unbounded payloads.

Memory remains namespaced, versioned, exportable, selectively deletable, sensitivity-aware, and
retention-aware as persistence expands.

## Required adversarial coverage

Security tests must continue covering at least:

- prompt injection requesting secrets, policy override, skill activation, or durable authority;
- malformed client/model/tool/skill/memory JSON and unknown fields;
- path traversal, symlink escape, unsafe archive/executable surfaces;
- SSRF, DNS rebinding, redirect bypass, reserved-address access, and exfiltration;
- credentials/secrets in prompts, logs, errors, command lines, patches, artifacts, memory, client data,
  sandbox metadata, evaluation reports, and compression output;
- replayed or duplicated external writes, payments/messages/deployments/sandbox allocations;
- stale/superseded worker settlement and cleanup/released-session resurrection;
- stale/conflicting client controls and confused-deputy capability scope;
- malicious/mutable/community skills, incomplete intake, transitive trust, and dependency substitution;
- forged/tampered/stale/future learning, model-evaluation, Skill OS selection, memory, and pack evidence;
- task-class relabeling or revoked-content reuse in Skill OS;
- memory conflict hiding, stale-source promotion, saturated-retention overclaim, compression tampering,
  runtime-issuance bypass, secret leakage, or sensitivity downgrade;
- tool descriptor/manifest mismatch, direct adapter execution, confirmation downgrade, idempotency bypass,
  and catalog-based capability escalation;
- provider/model/profile sandbox-binding confusion;
- quality-floor downgrade or budget bypass through fallback/retry/critique/repair/cache;
- race conditions across cancellation, checkpointing, tools, leases, client commands, sandbox allocation,
  cleanup, memory compression, and completion;
- denial-of-wallet and unbounded retry/tool/model/context growth;
- recovery from tampered/incompatible events, checkpoints, lifecycle pages, routing data, memory,
  capability packs, and release evidence.

## M26–M28 security constraints

The next package may implement repository-local/provider-neutral contracts but cannot claim live
infrastructure without separately authorized evidence.

- M26 must build on M3/M12 rather than create a new secret/tool/network path. Opaque secret brokering,
  exact sandbox identity, quotas, timeout, network/filesystem scope, cleanup, and audit must remain
  runtime-owned. Container/VM isolation claims require real isolated-backend evidence.
- M27 must preserve M2/M8 canonical semantics. Authenticated hosted adapters must enforce tenant/scope,
  idempotency, fencing, queue ownership, artifact isolation, audit, reconnect continuity, backup/recovery,
  and failure injection. Local SQLite is not distributed correctness evidence.
- M28 clients remain untrusted controllers. Offline cached state cannot authorize mutation; approval
  flows require current server-side scope/version; credentials and canonical mission state stay server-side.

No paid resource, deployment, production migration, live cloud/database/sandbox call, billing change, or
public traffic is authorized by the current M23–M25 delivery.

## Vulnerability reporting

Do not open a public issue containing an exploitable vulnerability, credential, or private user data.
Use the repository owner's private security reporting channel when enabled; otherwise contact the owner
privately with the smallest safe reproduction.
