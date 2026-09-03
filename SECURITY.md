# Security model

Status: design baseline plus implemented M1 provider, M3 tool-control, M5 verification, M6 memory/context,
M7 specialist coordination, M8 durable mission/worker, M9 client-protocol, M10 skill-lifecycle, and
M11 adaptive-routing safeguards. Controls not explicitly identified as implemented remain future work.

## Protected assets

- provider and integration credentials;
- user repositories, documents, memory, artifacts, and personal data;
- mission integrity, budgets, approvals, durable events, checkpoints, job state, and audit history;
- execution hosts, network access, connected devices, and external accounts;
- system-protected skills, policies, evaluation records, routing decisions, and release artifacts.

## Trust boundaries

Trusted: the minimal control plane, policy engine, secret broker, validated protocol handlers, and
durable state layer.

Untrusted by default: user/client input, web/email/chat content, repositories being analyzed,
dependency metadata, tool output, model output, community skills/plugins, generated code, browsers,
and workers. An instruction embedded in untrusted content never becomes runtime authority.

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

Capabilities bind the narrowest available subject and resource scope. Denial is the fallback for
malformed or missing policy data. A model, worker, skill, or client cannot mint authority merely by
including a capability-shaped object in its output.

## Credential handling

Long-lived credentials reside only in a protected credential store. Models, clients, and normal worker
processes receive neither raw keys nor a general-purpose environment containing them. The control plane
proxies requests or issues the narrowest possible short-lived handle. Redaction applies before logs,
events, artifacts, errors, memory, client payloads, or crash reports are persisted or returned.

The committed `.env.example` contains names and blank values only. Real `.env` files are ignored.

M1 resolves credentials only after request-shape and capability checks pass. Provider HTTP denies
redirects and obvious private-network targets by default, rejects header-delimiter credentials, bounds
responses/events, and normalizes transport errors. DNS rebinding and destination re-resolution remain
future outbound-network-policy work.

## Implemented M3 tool controls

Model-proposed tool calls are untrusted data. `src/tools` validates stable tool/version selection and
strict input schemas before policy or handler execution. Capability grants bind mission/task/tool/
operation/resource scope, call ceiling, and expiry. High-impact operations require matching unexpired
approval evidence.

Side-effecting calls require idempotency keys. Matching replays return the prior result while mismatched
replay fails. Handler attempts are bounded by runtime-owned timeout/cancellation and capability-call
ceilings. Audit records retain typed metadata and hashes rather than raw inputs or resource paths.

Built-in repository operations accept normalized workspace-relative paths and stable quality-command
IDs only. Arbitrary model-provided shell strings and network destinations are not accepted.

M3 is a control boundary, not a production sandbox. Canonical-root/symlink isolation, subprocess or
container isolation, CPU/memory/output limits, and destination-based network enforcement remain future
execution work.

## Implemented M5 verification safeguards

Planner/runtime assertions are not completion authority. M5 accepts bounded typed evidence with
canonical timestamps, allowlisted kinds/producers/statuses, exact mission/task scope, hashes, freshness,
and explicit coverage. Missing, foreign, stale, future, pre-change, failed, duplicated, contradictory,
or weak evidence fails closed.

A separate non-mutating adversarial reviewer can `ACCEPT`, `BLOCK`, or request bounded repair. Malformed
review output or reviewer failure blocks. The coding orchestrator cannot reach `COMPLETED` without an
internally consistent verifier pass and reviewer acceptance. Stored decisions use concise evidence
references and hashes rather than hidden reasoning.

## Implemented M6 memory and context safeguards

Memory records are isolated by exact user/project scope, with exact mission scope for working memory.
Records carry hashes, sensitivity, provenance, versions, expiry, and lifecycle state. Durable user
preferences require explicit-user provenance. Optimistic versions reject competing updates;
idempotency keys reject mismatched replay; tombstones remove raw content and prevent resurrection.

Retrieved memory is always compiled as lower-authority memory context. Source/priority validation stops
memory/history from impersonating system, mission, task, repository, or observation context. Current
authoritative sources win semantic collisions. Mandatory P0–P2 context cannot be silently truncated,
and sensitive compilations bypass cache. M6 memory remains an in-memory contract; encryption at rest,
retention enforcement, and cross-process cache coherence remain future work.

## Implemented M7 specialist safeguards

Specialist workers are untrusted proposal producers. Registry discovery exposes bounded metadata, not
handler authority. The coordinator selects dependency-ready M2 tasks, applies concurrency ceilings,
and reserves expiring logical ownership before calling a worker. Repository/resource/state write
claims conflict conservatively.

Workers receive immutable assignments and abort signals but no peer messaging, mission mutation,
repository adapter, policy, credential, or completion authority. Returned proposals use exact bounded
schemas. Foreign identity, future/impossible time, duplicate/malformed references, private-reasoning
fields, and writes outside ownership are blocked. A worker cannot self-certify independent evidence;
runtime attestation is required before reconciliation can accept evidence references.

M7 ownership is single-process logical coordination, not a durable cross-host lock or sandbox.

## Implemented M8 durable safeguards

`src/durable` is a trusted local persistence boundary over Node 24 built-in SQLite with foreign keys,
WAL, `synchronous=FULL`, bounded busy timeout, strict tables, and explicit schema versioning. Unknown
newer schemas fail closed.

Canonical M2 event batches enforce mission identity, contiguous sequence/aggregate versions, canonical
UTC time, mission-scoped idempotency fingerprints, bounded canonical JSON, and SHA-256 integrity.
Checkpoints are derived artifacts and must reproduce from canonical events before acceptance.

Durable jobs persist bounded orchestration metadata and artifact references/hashes, not raw prompts,
repository contents, credentials, raw worker exceptions, or plaintext lease tokens. Claims create
opaque random tokens but persist only their hashes. Heartbeat and settlement require exact job/
mission/task/worker scope, generation, token, and unexpired lease. Stale generations cannot settle after
reclaim. Retries are bounded; exhaustion blocks; cancellation defeats late success.

Lifecycle events are typed, hash-addressed, mission-scoped, and read through a globally increasing
cursor. Corrupt event hashes fail closed. M8 provides local at-least-once recovery, not exactly-once
external effects, hosted queues, leader election, multi-region durability, or cross-host fencing.

## Implemented M9 client safeguards

`src/client` treats every client request and every protocol payload as untrusted at the protocol
boundary. State and command requests use exact key sets, bounded identifiers/collections, canonical UTC
timestamps, explicit protocol versions, and fail-closed decoding. Unsupported versions, commands,
unknown fields, malformed counters, invalid states, and malformed lifecycle events are rejected.

Client capability identifiers are opaque. The runtime resolves the actual grant and requires exact
session and mission scope plus expiry. State reads require read authority. Commands are limited to
`mission.pause`, `mission.resume`, and `mission.cancel`; they require an exact expected mission version
and durable scoped idempotency. Clients cannot append arbitrary mission events, settle worker jobs,
call providers/tools, verify tasks, or complete missions.

Client projections expose only bounded user-facing state: mission identity/version/objective/focus,
task status, budgets, checkpoint version, durable job counts/activity, and evidence references. They
exclude provider keys, credentials, lease bearer tokens, raw repository contents, definitions of done,
failure signatures, private reasoning, raw worker exceptions, and hidden policy internals.

Reconnect uses M8 lifecycle event hashes plus exact mission/session scope and `afterCursor` chaining.
Because M8 lifecycle cursors are global but reads are mission-scoped, numeric gaps inside a mission are
valid. The client reducer rejects moving the requested cursor ahead of its accepted cursor, changed or
unknown replay hashes, foreign scope, incompatible protocol versions, and backwards mission
projections; unsafe continuity requires a fresh bootstrap.

The M9 web shell is a static reference fixture. Dynamic values are inserted with text/DOM APIs rather
than unsanitized HTML. It contains no live network transport, cookies, `localStorage`, or
`sessionStorage`. Cancellation requires a deliberate dialog confirmation. Production authentication,
transport security, CSP/security headers, push notifications, device administration, offline writes,
and native application security remain future work.

## Implemented M11 routing and reasoning safeguards

`src/routing` treats provider profiles, empirical evaluations, route requests, budgets, cache metadata,
and reasoning evidence as validated runtime inputs. A route is selected only after capability checks,
fresh independent evaluation evidence, and the effective quality floor are satisfied. Cost and latency
are optimization criteria only among candidates that already meet the quality requirement.

Evaluation records bind exact provider/model/profile version, task class, and reasoning effort where
applicable. They are hash-addressed and timestamped. Model-, worker-, and runtime-authored
self-evaluations cannot establish routing quality. Stale, future, duplicate, conflicting, malformed, or
hash-tampered evaluation data fails closed rather than silently lowering quality.

Risk and uncertainty can raise the effective quality floor but cannot lower the configured minimum.
Unknown/mismatched pricing cannot bypass a cost ceiling. Reasoning is bounded by explicit branch,
critique, repair, model-call, parallel-call, estimated-cost, and estimated-token ceilings. The token
ceiling derives a stricter effective model-call ceiling; if one estimated call does not fit, execution
is blocked. When bounded budget permits it, a repair slot is reserved before consuming every remaining
call on additional critique.

`AdaptiveReasoningController` accepts a result only with independent, non-contradictory PASS evidence.
Model confidence, majority vote, or critique text cannot complete a task or manufacture M5 evidence.
Escalation changes only the eligible model/effort route; it cannot mint M3 tool grants, M7 ownership,
M10 skill promotion, credentials, or additional mission budget.

Routing cache metadata binds request/context/evidence/model/profile/reasoning-policy identity and
freshness. Sensitive work disables caching. Cache hits never bypass M5 evidence checks. M11's evaluation
harness is offline and deterministic; no live provider benchmark, production traffic experiment, or
paid resource is claimed.

## Prompt injection and skill security

Every context item carries origin/trust metadata. Tool results and external content are data, not
instructions. Model output is schema-validated before requesting a transition or tool. Untrusted
observations cannot modify policy, protected skills, credentials, or durable user preferences.

Implemented M10 preserves this rule in `src/skills`: compact discovery omits instructions; normal
resolution accepts only verified/active packages; learned/community packages start as candidates;
package content is hash-addressed; independent passing evidence must bind the exact package hash; and
activation/rollback require trusted runtime or user-approved actors. Model, worker, and runtime-authored
verification claims cannot promote learned/community skills.

Skill synthesis additionally requires an injected solved-task attestation and can create only a learned
candidate with exact mission/task provenance. Exact replay is idempotent and conflicting replay fails
closed. Lifecycle events record concise actor/producer/evidence references for registration,
verification, activation, supersession, rollback, and revocation. Required-tool names are declarations
only: M10 never registers an M3 handler, creates a capability grant, exposes credentials, or grants
arbitrary host execution. Public skill downloads, package signing/marketplace trust, and executable
skill sandboxes remain future work.

## Audit and privacy

Consequential records should contain initiator, mission/task, action type, input hash, policy decision,
result, side-effect summary, verification, and timestamp without private chain-of-thought. Durable job
and client-facing records use typed statuses, reason codes, hashes, timestamps, and references rather
than raw prompts, credentials, or worker exceptions.

Memory must remain namespaced, versioned, exportable, selectively deletable, and retention-aware as
persistence expands.

## Threats required in security tests

- prompt injection requesting secrets or durable authority;
- malicious client/tool arguments and malformed model/protocol JSON;
- path traversal, symlink escape, and unsafe archive extraction;
- SSRF, DNS rebinding, redirect bypass, and network exfiltration;
- secrets in logs, errors, command lines, patches, artifacts, durable jobs, or client payloads;
- replayed external writes and duplicated payments/messages/deployments;
- stale/superseded worker settlement after lease expiry or recovery;
- stale/conflicting/replayed client controls and confused-deputy client capability scope;
- compromised plugin/skill packages and dependency substitution;
- forged, stale, future, self-authored, or tampered model-evaluation evidence;
- quality-floor downgrade or budget bypass through routing, fallback, retry, critique, repair, or cache;
- privilege escalation through retries, repair loops, fallback providers, or learned skills;
- race conditions between cancellation, checkpointing, tools, leases, commands, and completion;
- budget bypass and denial-of-wallet;
- recovery from tampered/incompatible events, lifecycle rows, checkpoints, client pages, and routing data.

## Vulnerability reporting

Do not open a public issue containing an exploitable vulnerability, credential, or private user data.
Use the repository owner's private security reporting channel when enabled. Until then, contact the
owner privately and provide the smallest safe reproduction.