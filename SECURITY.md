# Security model

Status: implemented M1 provider, M3 tool-control, M5 verification, M6 memory/context, M7 specialist
coordination, M8 durable mission/worker, M9 client-protocol, M10 skill-lifecycle, M11 adaptive-routing,
M12-A/B/C local execution/sandbox, observability, recovery-evidence, and release-gate safeguards, one M12-D bounded live-provider credential path, M13 evidence-backed learning safeguards, and M14 bounded external-skill intake safeguards. Controls not explicitly identified as implemented remain future work.

## Protected assets

- provider and integration credentials;
- user repositories, documents, memory, artifacts, and personal data;
- mission integrity, budgets, approvals, durable events, checkpoints, job state, and audit history;
- execution hosts, network access, connected devices, and external accounts;
- system-protected skills, policies, evaluation records, routing decisions, sandbox sessions, and release artifacts.

## Trust boundaries

Trusted: the minimal control plane, policy engine, secret broker, validated protocol handlers, sandbox
backend configuration, and durable state layer.

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
proxies requests or resolves the narrowest configured credential only after policy/binding checks.
Redaction applies before logs, events, artifacts, errors, memory, client payloads, or crash reports are
persisted or returned.

The committed `.env.example` contains names and blank values only. Real `.env` files are ignored.

M1 resolves credentials only after request-shape and capability checks pass. M12 extends provider
credential resolution with exact provider/model context, allowing different routed models to use
different configured credentials without placing those keys in prompt or worker data.

Sandbox credentials are held behind runtime-owned `credentialRef`s. Public binding metadata exposes
backend identity and credential requirement, not the credential reference or secret value.

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

M3 remains the capability/tool authority. M12-A/B add canonical-root and symlink-escape checks, a
bounded trusted-command host-process runner, output/time/concurrency limits, and a fail-closed outbound
destination policy. The host-process runner is still not kernel/container isolation, and the outbound
policy alone is not transport-level DNS pinning.

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

Client projections expose only bounded user-facing state. They exclude provider keys, credentials,
lease bearer tokens, raw repository contents, definitions of done, failure signatures, private
reasoning, raw worker exceptions, and hidden policy internals.

Reconnect uses M8 lifecycle event hashes plus exact mission/session scope and `afterCursor` chaining.
Because M8 lifecycle cursors are global but reads are mission-scoped, numeric gaps inside a mission are
valid. Unsafe continuity requires a fresh bootstrap.

The M9 web shell is a static reference fixture. It contains no live network transport, cookies,
`localStorage`, or `sessionStorage`. Production authentication, transport security, CSP/security
headers, push notifications, device administration, offline writes, and native application security
remain future work.

## Implemented M10 skill safeguards

`src/skills` keeps compact discovery separate from full instruction loading. Normal resolution accepts
only verified/active packages; learned/community packages start as candidates; package content is
hash-addressed; independent passing evidence must bind the exact package hash; activation/rollback
require trusted runtime or user-approved actors.

Skill synthesis requires an injected solved-task attestation and can create only a learned candidate
with exact mission/task provenance. Required-tool names are declarations only: M10 never registers an
M3 handler, creates a capability grant, exposes credentials, or grants arbitrary host execution.

## Implemented M11 routing and reasoning safeguards

`src/routing` treats provider profiles, empirical evaluations, route requests, budgets, cache metadata,
and reasoning evidence as validated runtime inputs. A route is selected only after capability checks,
fresh independent evaluation evidence, and the effective quality floor are satisfied. Cost and latency
are optimization criteria only among candidates that already meet the quality requirement.

Evaluation records bind exact provider/model/profile version, task class, and reasoning effort where
applicable. Model-, worker-, and runtime-authored self-evaluations cannot establish routing quality.
Stale, future, duplicate, conflicting, malformed, or hash-tampered evaluation data fails closed.

Risk and uncertainty can raise the effective quality floor but cannot lower it. Reasoning is bounded by
explicit branch, critique, repair, model-call, parallel-call, estimated-cost, and estimated-token
ceilings. Only independent, non-contradictory PASS evidence can accept a result.

Routing cannot mint M3 tool grants, M7 ownership, M10 skill promotion, credentials, or additional
mission budget. Sensitive work disables routing cache. M11's evaluation harness is offline and
deterministic; no live provider benchmark or production traffic experiment is claimed.

## Implemented M12-A/B execution and sandbox safeguards

`src/sandbox` treats workspace paths, subprocess outcomes, destination URLs, model/sandbox bindings,
provider-managed session metadata, and lifecycle requests as validated runtime data.

### Workspace and process

- the trusted workspace root is canonicalized through the host filesystem;
- lexical traversal, absolute paths, NUL/backslash ambiguity, root-prefix confusion, and canonical
  symlink escapes are denied;
- writes resolve through the nearest existing canonical parent;
- models/workers select only runtime-registered command IDs; executable path and fixed arguments are
  trusted configuration;
- process execution uses `shell: false`;
- child environment starts deny-by-default and inherits only explicitly allowlisted variables;
- timeout and cancellation terminate the process;
- stdout and stderr are independently byte-bounded and output flood terminates execution;
- runtime concurrency is bounded, with the slot reserved before asynchronous cwd resolution and always
  released in `finally`.

This is a bounded host-process boundary, **not** OS/kernel/container isolation. It does not prevent all
host filesystem visibility or provide namespace/cgroup isolation for arbitrary untrusted code.

### Outbound destination policy

- HTTPS is the default;
- URL credentials, fragments, ambiguous syntax, and unauthorized host/port destinations are denied;
- loopback, link-local, private, multicast, unspecified, mapped-private, and other reserved addresses
  are denied;
- every injected DNS answer must satisfy policy;
- redirects or destination changes require a fresh decision.

A future transport must consume the exact policy decision without unsafe re-resolution before DNS
rebinding resistance can be claimed.

### Provider/model-dependent sandbox lifecycle

- exact `provider + model + profileVersion` identity selects the configured sandbox backend;
- M11 primary or escalation routing provides that exact identity;
- sandbox credentials are resolved only after exact binding checks and stay in the control plane;
- remote create receives a deterministic allocation/idempotency key;
- exact replay reuses the settled session and concurrent identical replay collapses to one create;
- conflicting replay fails closed;
- remote backends must implement deterministic cleanup at registry construction;
- destroy receives a deterministic release idempotency key and exact mission/task/model/session scope;
- release replay is idempotent and released sessions cannot be silently reused;
- session expiry is canonical UTC when provided and omitted structurally when absent.

Normal PR CI `33794095989` verified the M12-A/B local tranche with 237/237 tests. No hosted sandbox
provider, live model provider, paid resource, production deployment, migration, billing change, or
public traffic was exercised.

## Implemented M12-C observability and release-proof safeguards

`src/observability` rejects dangerous metadata keys and obvious secret-like values before event
materialization. Events carry only bounded typed metadata, canonical timestamps, and deterministic
identity; raw credentials, full environments, private reasoning, and unbounded process output are not
valid event content.

`src/release` binds evidence to exact producer, level, subject, status, timestamp, and content hash.
Release manifests bind exact commit/config/suite/policy/evidence identities. Policy levels are monotonic:
stronger claims retain lower-level requirements and must add evidence genuinely produced at the stronger
level. Missing, stale, future, foreign, failed, tampered, duplicated, unreferenced, or weak evidence
blocks. Backup/restore verification binds restored-state hash to the source-state hash and cannot claim
cloud/production recovery without separately exercised infrastructure.

Concurrent identical sandbox release now collapses to one remote cleanup call; a conflicting release
reason fails closed. Normal PR CI `33796268313` passed 258/258 tests. The local end-to-end release proof
explicitly passes `local` and blocks `integration`/`live` when only local evidence exists.

## Implemented M12-D live-provider safeguards

The M12-D runner resolves `NV_API_KEY` only inside GitHub Actions and only after exact
`nvidia + moonshotai/kimi-k3` credential context checks. The key is not part of prompts, fixture state,
result JSON, committed files, or persisted reasoning. The workflow reruns deterministic repository
gates before any live request and caps the coding mission at two provider calls.

Run `33837291528` used one provider call and completed first pass with deterministic quality and M5 PASS.
The uploaded artifact is intentionally sanitized and the live workflow was changed to manual-only after
the evidence run. This proves the credential/provider boundary for one task; it does not authorize or
prove hosted sandbox access, customer data, public production traffic, repeated benchmark sweeps, or
other provider credentials.

## Implemented M13 learning safeguards

`src/learning` treats every proposed lesson as untrusted data. Before evidence lookup or persistence, proposal shape/scope/bounds are validated and obvious credential-like content is rejected across semantic key, lesson, source reference, and tags. The model-provided sensitivity label is never sufficient evidence that content is safe.

A learning attestation must be an exact independently backed PASS bound to user, project, mission, task, semantic-key SHA-256, lesson SHA-256, sensitivity, verification-result SHA-256, and non-empty evidence references. One task can count only once. Exact idempotent replay returns prior state without requiring a new attestation; changed input under the same replay key fails closed before evidence lookup, and the existing post-await replay check prevents asynchronous races from bypassing the replay contract.

Three distinct verified mission/task pairs are required before a lesson becomes `ESTABLISHED`. Competing active content under the same scoped key forces `CONFLICTED`; conflicted records cannot be emitted as nudges or written to M6. Maintenance may archive stale conflicts only below the establishment-support threshold, then deterministically re-evaluate the surviving group. It never silently deletes established M6 memory.

M13-created M6 memory has `verified_learning` provenance and remains lower authority: broad semantic retrieval excludes it unless `m13-learning` is explicitly requested. M13 cannot create M3 handlers/grants, mark M2/M5 work complete, activate M10 skills, resolve credentials, change M11 quality floors, increase budgets, or infer durable user preferences.

## Implemented M14 skill-intake safeguards

External skills, plugins, catalogs, scripts, hooks, MCP files, and workflow definitions are untrusted data. M14 requires a trusted resolver to bind the requested repository/ref/path to one immutable commit and rejects source-identity confusion before candidate creation. Mutable catalog reputation or an official publisher name is provenance context, not runtime authority.

Analysis is resource-bounded and non-executing: file count, file bytes, total bytes, path depth, and finding output are capped; no package install, subprocess, shell, browser, MCP execution, archive expansion, or third-party network execution is part of intake. Binary/symlink/oversize/incomplete inventory, unknown license state, malformed manifests, and finding truncation force explicit partial coverage and cannot yield a clean accept. Nested `.github/workflows`, hooks, MCP configuration, and executable surfaces are detected as risk-bearing content.

Risk findings use bounded rule identifiers, severity, file/content hashes, and stable fingerprints rather than storing matched raw snippets. Critical prompt-override, exfiltration, download-and-execute, or privilege-escalation patterns reject. High-risk credential collection, destructive mutation, self-promotion, policy/memory poisoning, MCP authority, hooks/workflows, or executable surfaces quarantine. Static M14 analysis proves only its bounded rules and completeness contract; it is not a universal proof that third-party code is safe.

Only `COMPLETE + ACCEPT` can be handed to M10 as a `community` candidate with `requiredTools=[]`. M14 cannot activate a skill, register M3 tools, mint grants/approvals, resolve credentials, change routing/budgets, or create completion evidence. M10 independent verification and trusted promotion remain mandatory. Normal PR CI `33858888408` passed 290/290 tests with Biome, strict TypeScript, and secret-free Kimi dry smoke; dedicated regressions cover malformed manifests and nested workflow surfaces.

## Implemented M15 capability-curation safeguards

M15 treats distilled procedures, evaluation output, curation requests, pack metadata, and replay inputs as untrusted data unless a trusted runtime boundary validates them. Curation binds the exact M10 community-candidate hash and lifecycle, one domain, bounded task classes, context ceilings, and runtime-owned procedure keys. A trusted runtime clock—not caller-supplied time—controls evaluation freshness; future caller timestamps and stale-evidence rescue attempts fail closed.

Procedure novelty is not self-declared authority. Requested keys must belong to the canonical runtime procedure set or the runtime-owned additive catalog for the selected domain. Independent PASS evidence must cover every requested task class and preserve quality, safety, authority, token, and latency floors. M15 may verify the exact M10 candidate but never activate it.

Capability packs accept only integrity-valid passing M15 reports whose candidate/domain/task-class identity matches an exact M10 VERIFIED/ACTIVE community member and whose M10 verification history carries the same evidence references at the same evaluation time. Compact pack discovery omits instructions; full resolution remains behind M10 lifecycle checks. Offline replay receives no mutation interface and can only emit bounded recommendations.

The bounded live A/B runner keeps provider credentials in the control plane, caps calls, and writes only sanitized evidence. Helper run `33866236138` verified the pre-merge boundaries with 319/319 tests. Authorized post-merge run `33870210502` then exposed an evidence-interpretation edge case: all six arms were incomplete, so the historical numeric zero summary could be mistaken for measured zero lift even though no matched pair completed. The raw evidence remains fail-closed and unpromoted; post-run hardening classifies zero complete pairs as `INCONCLUSIVE` with null quality/lift and records only bounded failure categories rather than raw exception text.

Second authorized run `33879714040` used nine provider calls and again remained INCONCLUSIVE. All six bounded failures were `provider_timeout`. Candidate-overlay arms timed out before mutation on the first call; baseline arms mutated after planning and timed out on the second repair call. The review found that v1 used 180000 ms for both provider timeout and candidate latency acceptance, so a latency overrun could be aborted before becoming a complete measured failure. The v2 live profile requires measurement timeout to exceed acceptance by at least 30000 ms, caps timeout at 600000 ms, binds stable provider/model/profile identity and reasoning settings, and includes profile identity in evidence. Run `33882837781` verified the v2 profile offline with 329/329 tests and no provider secret/request. A third live provider request remains separately approval-gated.

## Implemented M17–M19 reliability, efficiency, and multi-file safeguards

M17 normalizes failure evidence into bounded categories without persisting raw provider/tool exceptions.
Retry is denied after unknown or irreversible side effects; reversible mutations require runtime-owned
preimage evidence. Recovery budgets and repeated-strategy signatures prevent unbounded retry/repair or
escalation loops. The recovery controller cannot mint M3 grants or M5 completion evidence.

M18 optimization cannot discard mandatory P0–P2 authority context or verification-critical evidence.
Delta/cache identity binds mission/task scope, model profile, policy, stable source identity, and
verification requirements. Sensitive context is excluded from retained reuse. Early exit requires fresh
independent non-contradictory evidence; token reduction never lowers the M11 quality floor.

M19 accepts at most 100 canonical workspace-relative targets and blocks duplicate/ancestor overlap,
forbidden `.git`, workflow, dependency, or `.env` surfaces, stale preimages, tampered postimages,
cycles, and ownership conflicts before mutation. Runtime-trusted preimages are captured before the
workspace commit boundary. Any partial commit, post-commit verification exception, failed quality/M5
gate, or cancellation after mutation enters fail-closed restoration. Restoration does not inherit an
already-aborted task signal and its independent evidence must match the exact preimage snapshot hash.
Even a misconfigured injected recovery authority cannot prevent restoration once mutation occurred; the
runtime then reports `ROLLBACK_FAILED` rather than claiming success. The injected workspace adapter must
supply its own atomic/staging semantics; current tests do not prove OS/filesystem atomicity for a future
production adapter.

Helper run `33949434835` passed 379/379 tests with all configured deterministic gates and no live
provider credential/request.

## Prompt injection and untrusted-content security

Every context item carries origin/trust metadata. Tool results and external content are data, not
instructions. Model output is schema-validated before requesting a transition or tool. Untrusted
observations cannot modify policy, protected skills, credentials, sandbox bindings, or durable user
preferences.

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
- secrets in logs, errors, command lines, patches, artifacts, durable jobs, client payloads, or sandbox metadata;
- replayed external writes and duplicated payments/messages/deployments/sandbox allocations;
- stale/superseded worker settlement after lease expiry or recovery;
- stale/conflicting/replayed client controls and confused-deputy client capability scope;
- compromised plugin/skill packages, mutable upstream refs, transitive catalog trust, incomplete scans, and dependency substitution;
- forged, replayed, hash-mismatched, secret-bearing, cross-scope, or conflicting post-task learning evidence;
- forged, stale, future, self-authored, or tampered model-evaluation evidence;
- sandbox binding confusion between provider/model/profile identities;
- cleanup failure, replay, or released-session resurrection;
- quality-floor downgrade or budget bypass through routing, fallback, retry, critique, repair, or cache;
- privilege escalation through retries, repair loops, fallback providers, learned skills, or sandbox selection;
- race conditions between cancellation, checkpointing, tools, leases, commands, sandbox allocation, cleanup, and completion;
- budget bypass and denial-of-wallet;
- recovery from tampered/incompatible events, lifecycle rows, checkpoints, client pages, routing data, and release evidence.

## Vulnerability reporting

Do not open a public issue containing an exploitable vulnerability, credential, or private user data.
Use the repository owner's private security reporting channel when enabled. Until then, contact the
owner privately and provide the smallest safe reproduction.

## M15 live failure-evidence hardening — rerun 3

Live candidate evaluation must not create survivorship bias by discarding deterministic failures. The runtime now treats only an explicit bounded set of terminal task failure codes as complete negative measurements. Transient or ambiguous provider failures—including timeout, network, authentication, quota/rate-limit, unavailable/unknown, and generic malformed-response categories—remain incomplete. This prevents both hiding a candidate failure and falsely blaming a model for an infrastructure/transport ambiguity.

Failed arms keep fail-closed token/quality accounting, raw exception text is not persisted, and the historical live artifact is never rewritten. Rerun-3 derived evidence is PARTIAL rather than promoted: two complete pairs are 0 vs 0 and one remains incomplete. The candidate receives no M10 verification, activation, tool authority, credential access, routing privilege, or pack membership. Normal CI `33888060837` also proves the three fixture patterns succeed through the same deterministic M4/M5 path with valid scripted structured output.


## M20–M22 autonomy, routing, and evaluation safeguards — active PR #32

M20 soak observations are runtime data, not model-authored authority. The producer and replay paths both
require the exact event-specific field set; unknown, missing, or misplaced fields fail closed. Every replay
enforces a contiguous SHA-256 chain and monotonic synthetic time. Restarts must name the latest trusted
checkpoint, recovered leases must strictly increase generation, stale settlement cannot win, cancellation
blocks late success, repeated equivalent failure signatures are bounded, and profile/event/restart/
recovery/budget ceilings are runtime-owned. M8 durable state remains canonical. Synthetic logical duration
is not evidence of production uptime.

M21 recent route failures are negative routing evidence only. They are exact provider/model/profile/
reasoning/task-class/signature records with bounded age and hash integrity. Stale entries are ignored;
future/tampered/malformed entries fail. The layer can remove an exact recently failing route but cannot
invent positive evaluation quality, lower M11 quality floors, grant capability, increase budget, resolve
credentials, or choose a stronger sandbox scope. The remaining candidates still pass normal M11 checks.

M22 treats benchmark cases and results as untrusted evidence objects. Hidden acceptance metadata is
excluded from the model-facing projection; result identity is bound to suite/case/arm/model/profile/
reasoning/harness/budget and bounded execution metrics. Matched arms must have equal identity and budget,
results beyond per-case ceilings fail, and multiple results for one arm cannot be cherry-picked. Only
complete attributable outcomes are scored. Deterministic terminal task failures remain complete negative
evidence, while timeout/network/auth/rate-limit/unavailable/malformed/unknown infrastructure ambiguity is
INCOMPLETE and excluded from numeric lift. A zero-complete-pair report is INCONCLUSIVE with null numeric
lift. These reports cannot mint M3/M5/M10/M11/M12/release authority, and this package performs no live
provider or external-agent benchmark.
