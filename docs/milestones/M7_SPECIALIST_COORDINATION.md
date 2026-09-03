# M7 — Specialist coordination task contract

Status: implementation in progress. Updated: 2026-09-03.

## Objective

Build the smallest deterministic coordination slice that can assign independent M2 tasks to bounded
specialist workers, reserve logical ownership before parallel execution, accept only structured
results, and reconcile partial success without allowing peer-to-peer agent chatter or overlapping
writes.

The research lesson is explicit: keep isolated delegation and compact structured handoffs; improve it
with dependency, file, resource, and shared-state analysis; replace informal agent conversations with
runtime-owned assignments/results; avoid concurrent writers, unbounded fan-out, stale work, hidden
side effects, and self-certified completion.

## Acceptance criteria

- A bounded specialist registry separates compact discovery metadata from injected worker handlers.
  Profiles declare stable ID/version, roles, capabilities, maximum concurrency, provenance, and trust
  class. Duplicate or malformed profiles fail closed.
- Coordination task specifications reference existing M2 task IDs and declare role, goal, required
  capabilities, context package hash/source fingerprint, and explicit read/write ownership claims.
- Ownership namespaces distinguish repository paths, resources, and shared state. Repository paths use
  normalized workspace-relative forms. Read/read sharing is allowed; any intersecting claim involving
  a write conflicts. Ancestor/descendant repository paths conflict conservatively.
- Only tasks returned by the M2 dependency-aware scheduler are assignable. Missing specs, missing
  capability/role matches, active ownership conflicts, and exhausted worker capacity are reported as
  typed deferrals rather than silently ignored.
- Batch size and active execution are bounded by runtime configuration and each specialist profile.
  Selection, assignment IDs, worker choice, task order, and deferral order are deterministic for
  equivalent state.
- Planning reserves expiring, mission/task-bound leases before execution. Tampered, foreign, expired,
  replayed, or already released assignments cannot execute.
- Each worker receives one immutable assignment envelope and one context-package reference. The worker
  interface exposes no peer messaging, mission transition, repository, tool, credential, or policy
  authority.
- Workers return structured proposals containing outcome, result summary, evidence references, files
  changed, artifacts, assumptions, risks, remaining work, and an evidence-based verification status.
  No numeric confidence or private reasoning is accepted or persisted.
- The coordinator validates output identity, timestamps, bounds, evidence/artifact hashes, uniqueness,
  and changed-file ownership. A worker cannot report a write outside its reserved claims.
- Reconciliation returns `ACCEPTED`, `RETRY_REQUIRED`, or `BLOCKED` per task plus deterministic hashes.
  Only a successful proposal with `VERIFIED` status may be accepted; coordinator output is data and
  does not itself mutate M2 mission/task state.
- Leases and logical locks are released after every success, failure, timeout-like rejection, or
  malformed result. One failed worker does not erase an independently accepted sibling result.
- Tests cover dependency readiness, deterministic specialist selection, missing capability, batch and
  worker capacity, read/read compatibility, file/resource/state conflicts, active and expired leases,
  plan tampering/replay, malformed/foreign output, unowned writes, partial failure, deterministic
  reconciliation, and a two-specialist parallel vertical slice.
- CI uses injected deterministic workers and no provider, subagent service, repository mutation,
  external network, database, deployment, or paid resource.

## Invariants

- The runtime, never a specialist, owns scheduling, leases, concurrency, result validation, and
  reconciliation.
- A specialist result is an untrusted proposal until the coordinator validates its assignment binding
  and evidence.
- Parallel work is an optimization only for dependency-ready tasks with non-conflicting ownership.
- Specialists cannot communicate directly; all coordination crosses typed runtime-owned artifacts.
- Logical locks prevent contract-level overlap but are not an OS sandbox, distributed lock, or durable
  worker lease claim.
- `VERIFIED` requires supplied evidence metadata; a specialist cannot become completion authority by
  labeling an unsupported result successful.

## Out of scope

- Real subprocess/container/worktree isolation, worker RPC, distributed queues, durable leases, or
  multi-host recovery.
- Automatic repository patch merging, AST reconciliation, conflict resolution, or M2 status mutation.
- Live model calls, model routing/escalation, tool grants, provider credentials, or specialist prompt
  templates.
- Shared multi-agent memory writes, chat rooms, peer-to-peer messaging, voting, or recursive delegation.
- Full skill package discovery/loading/promotion, which remains M10.

## Verification strategy

Run `npm run verify`. M7 is `VERIFIED` only after local adversarial review/repair and both implementation
and synchronized-documentation pull-request CI checkpoints pass. Until then all M7 roadmap claims
remain open.
