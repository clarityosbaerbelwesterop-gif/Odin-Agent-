# Security model

Status: design baseline plus implemented M1 provider-boundary, M3 tool-control, M5 verification, M6
memory/context, M7 specialist-coordination, and M8 durable mission/worker safeguards.
Controls not explicitly identified as implemented remain future work.

## Protected assets

- provider and integration credentials;
- user repositories, documents, memory, artifacts, and personal data;
- mission integrity, budgets, approvals, durable events, checkpoints, job state, and audit history;
- execution hosts, network access, connected devices, and external accounts;
- system-protected skills, policies, and release artifacts.

## Trust boundaries

Trusted: the minimal control plane, policy engine, secret broker, validated protocol handlers, and
durable state layer.

Untrusted by default: user input, web/email/chat content, repositories being analyzed, dependency
metadata, tool output, model output, community skills/plugins, generated code, browsers, and workers.
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

Capabilities bind subject, tenant, mission, task, tool, resource, allowed operation, network scope,
secret handle, call limit, and expiry. Policy decisions are `ALLOW`, `DENY`, `REQUIRE_APPROVAL`, or
`ALLOW_WITH_RESTRICTIONS`. Denial is the fallback for malformed or missing policy data.

The implemented M3 policy currently binds mission, task, tool, operation, resource prefix, call
ceiling, and expiry. High-risk tool calls require matching unexpired approval evidence. Tenant,
network-scope, and secret-handle capability fields remain later control-plane work and are not claimed
by the in-memory M3 policy adapter.

## Credential handling

Long-lived credentials reside only in a protected credential store. Models and normal worker
processes receive neither raw keys nor a general-purpose environment containing them. The control
plane proxies requests or issues the narrowest possible short-lived handle. Redaction applies before
logs, events, artifacts, errors, memory, or crash reports are persisted.

The committed `.env.example` contains names and blank values only. Real `.env` files are ignored.

The M1 adapters resolve a credential only after request shape and capability checks pass. They deny
redirects and obvious private-network base URLs by default, reject credentials containing header
delimiters, bound response/event sizes, and normalize transport errors without copying thrown
messages. DNS rebinding protection and destination re-resolution still belong to the later network
policy boundary and are not claimed here.

## Implemented M3 tool controls

Model-proposed tool calls are untrusted data. `src/tools` validates stable tool/version selection and
strict input schemas before policy or handler execution. Unsupported schema keywords, unknown input
properties, missing required values, invalid types, and configured bound violations fail closed.

Side-effecting tools require non-empty idempotency keys. Calls sharing the same mission/task/tool/
version/key are serialized before execution; a matching replay returns the prior result and a key
reused with different input fails. Side-effecting handlers are single-attempt in M3 until a worker
boundary can prove idempotent execution across timeout/crash boundaries.

Every handler attempt is bounded by runtime-owned timeout/cancellation and capability-call ceilings.
Audit records contain mission/task/tool metadata, policy/result classification, attempt/timestamps,
and SHA-256 hashes of input and resolved resource. Raw tool inputs and raw resource paths are not
persisted by the M3 audit record contract.

The built-in repository registrations accept workspace-relative paths only, reject absolute paths,
backslashes, NULs, and `..` traversal, and expose quality commands only through pre-discovered stable
command IDs. They do not accept arbitrary shell strings or network destinations.

## Execution and network

Production sandbox/container execution is not implemented. The current repository tools call injected
workspace and quality-runner interfaces so the control boundary can be tested without host execution.
Path normalization is defense in depth, not proof of canonical-root or symlink isolation.

A later execution boundary must run generated commands in ephemeral, resource-limited workspaces with
explicit filesystem roots, CPU/memory/time/output limits, canonical path checks, and destination-based
network policy. HTTP tools must resolve and validate destinations before and after redirects to resist
SSRF, DNS rebinding, and private-network access.

Plugins capable of code execution must run out of process over authenticated, versioned RPC. Packages
must be pinned, provenance recorded, and community extensions begin with no authority.

## Implemented M5 verification safeguards

Planner/runtime assertions and repository or tool output are not completion authority. M5 accepts
only bounded typed evidence with canonical timestamps, allowlisted kinds/producers/statuses, explicit
mission/task scope, and SHA-256 content metadata. Missing, foreign, stale, future, pre-change, failed,
duplicated, or contradictory evidence fails closed.

Adversarial review is a distinct non-mutating interface. Its verdict, findings, repair request, scope,
and deterministic hash are validated before use; malformed output or reviewer failure becomes a
blocking result. The coding orchestrator performs a post-change scoped read and cannot transition to
`COMPLETED` unless verification returns internally consistent `PASS` and `ACCEPT` results. Verdicts
store concise evidence references and hashes rather than raw source, tool output, or hidden reasoning.

## Implemented M6 memory and context safeguards

Memory records are isolated by exact user/project scope, with an additional exact mission boundary for
working memory. Records carry canonical timestamps, hashes, sensitivity, provenance, versions, expiry,
and lifecycle state. Durable user preferences require explicit-user provenance; inferred preferences
fail closed. Optimistic versions reject competing updates, idempotency keys reject mismatched replay,
and retrieval is bounded and deterministic.

Tombstones remove raw memory content, content-like keys/tags, and earlier write replay results from the
in-memory adapter. A tombstoned stable ID cannot be resurrected or returned by retrieval. Revision
history retains metadata only. Provenance references are expected to be opaque identifiers; secrets or
raw personal data must not be placed in IDs, tags, keys, or references.

Retrieved memory is always compiled as P5 data. Source/priority validation prevents memory or history
from impersonating system, mission, task, repository, or observation context. Current authoritative
sources win semantic collisions. P0–P2 cannot be silently truncated, malformed hashes/timestamps and
budgets fail closed, sensitive candidates bypass the compile cache, and memory mutations trigger
targeted cache invalidation.

Session snapshot hashes detect accidental corruption and bind the snapshot to a mission/event version
and raw-history reference. They are not signatures. M8 durability does not automatically make M6
memory durable; encryption at rest, retention, and cross-process cache coherence remain unimplemented.

## Implemented M7 specialist-coordination safeguards

Specialist workers are untrusted proposal producers. Registry discovery reveals bounded metadata but
not handler references. The coordinator selects only dependency-ready M2 tasks, applies global/batch/
worker capacity ceilings, and reserves expiring mission/task/specialist-bound logical leases before
calling a worker. Repository, resource, and shared-state claims block intersecting writes; read/read
sharing is explicit.

Assignments are immutable data plus an abort signal and expose no peer messaging, mission mutation,
repository adapter, tool runtime, policy, credentials, or evidence authority. Returned proposals use
an exact bounded schema. Foreign identity, impossible/future time, duplicate or malformed references,
unsupported fields such as numeric confidence/private reasoning, and changed files outside reserved
write claims are blocked. Raw worker exceptions are reduced to typed reasons rather than persisted.

A specialist cannot self-certify by labeling evidence `independent_tool`. `ACCEPTED` requires an
injected runtime authority to attest at least one matching passing evidence reference, and the
reconciliation records the attested IDs. Reconciliation still cannot mark an M2 task verified or a
mission complete; M5 remains the final claim/evidence completion authority.

M7 repository/resource/state ownership remains in-memory and single-process. M8 adds a separate
durable worker-job lease/fencing contract, but does not convert M7 logical ownership into a durable
cross-host lock or symlink-safe repository isolation boundary.

## Implemented M8 durable mission and worker safeguards

`src/durable` is a trusted local persistence boundary over Node 24 built-in SQLite. It enables foreign
keys, WAL, `synchronous=FULL`, a bounded busy timeout, strict tables, and an explicit schema version.
Unknown newer schema versions fail closed. Database paths are trusted runtime configuration, not model
output.

Canonical M2 event batches are stored with mission identity, contiguous sequence/aggregate version,
canonical UTC time, mission-scoped idempotency fingerprint, bounded canonical JSON, and SHA-256 data
hash. Reopen validates identity, sequence, hash, and event shape rather than skipping corrupt rows.
Checkpoint JSON is size-bounded and integrity checked. A checkpoint must match its metadata and
reproduce from canonical mission events before it is accepted. Lower-level checkpoint integrity
errors are normalized to the durable corruption error boundary.

Durable jobs persist only bounded orchestration metadata and artifact references/hashes. Raw prompts,
repository contents, credentials, raw worker exceptions, and raw lease tokens are not job metadata.
Each claim creates an opaque random lease token but stores only its SHA-256 hash. Heartbeat and
settlement require exact job/mission/task/worker scope, matching fencing generation/token, and an
unexpired lease. A stale or superseded generation cannot settle after another worker reclaims work.

Retries consume attempts and are bounded. Exhausted work becomes terminal `BLOCKED`. Pending/retry
cancellation is terminal immediately; running work becomes `CANCELLING`, and cancellation defeats a
late success proposal. The runner owns timeout, heartbeat, cancellation observation, and settlement;
handlers receive only an immutable lease/job envelope and `AbortSignal`, not database, policy,
credential, peer, or mission-completion authority.

Lifecycle events are typed, hash-addressed, mission-scoped, and read by a strictly increasing cursor.
Tampered lifecycle hashes fail closed. Reconnect/reopen tests prove cursor continuation without
accepting stale settlement. The 32-job fixture proves bounded local recovery behavior without live
external I/O.

M8 guarantees neither exactly-once external effects nor distributed correctness. A handler may have
performed an external side effect before losing its lease; side-effecting M3 tools must still use their
own idempotency contracts. SQLite is a local single-runtime persistence target, not a hosted queue,
leader-election system, multi-region service, or cross-host fencing authority.

## Prompt injection and durable learning

Every context item carries origin and trust metadata. Tool results are quoted as data. Model output
is schema-validated before it can request a transition or tool. Untrusted observations cannot modify
policy, system-protected skills, credentials, or durable user preferences.

Agent-learned skills follow candidate, provenance review, replay tests, independent verification,
versioned staging, and promotion. All promotions are reversible and auditable.

## Audit and privacy

Consequential records contain initiator, mission/task, action type, input hash, policy decision,
result, side-effect summary, verification, and timestamp. Do not persist private chain-of-thought;
store concise decision records and evidence. Memory is namespaced, versioned, exportable, selectively
deletable, and retention-aware.

Durable job/event records use stable identifiers, typed status, reason codes, hashes, timestamps, and
artifact references rather than raw prompts or worker exceptions. Lease bearer tokens are never stored
in plaintext.

## Threats required in security tests

- prompt injection requesting secrets or durable authority;
- malicious tool arguments and malformed model JSON;
- path traversal, symlink escape, and unsafe archive extraction;
- SSRF, DNS rebinding, redirect bypass, and network exfiltration;
- secrets in logs, errors, command lines, patches, artifacts, or durable job metadata;
- replayed external writes and duplicated payments/messages/deployments;
- stale/superseded worker settlement after lease expiry or recovery;
- confused-deputy access across user, tenant, mission, task, worker, or device;
- compromised plugin/skill packages and dependency substitution;
- privilege escalation through retries, repair loops, or fallback providers;
- race conditions between cancellation, checkpointing, tools, leases, and completion;
- budget bypass and denial-of-wallet;
- recovery from tampered/incompatible events, lifecycle rows, or checkpoints.

## Vulnerability reporting

Do not open a public issue containing an exploitable vulnerability, credential, or private user data.
Use the repository owner's private security reporting channel when enabled. Until that channel is
configured, contact the owner privately and provide the smallest safe reproduction.
