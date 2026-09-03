# ADR-0008: Runtime-owned specialist coordination

- Status: accepted
- Date: 2026-09-03

## Context

The Hermes/OpenClaw research supports isolated delegation with compact handoffs, but informal peer
chat and concurrent access to shared repositories or resources can corrupt work and context. Odin
already has a dependency-aware M2 task graph, M3 policy boundaries, M5 verification authority, and M6
context-package hashes. M7 needs parallelism without transferring scheduler, policy, tool, mission, or
completion authority to a specialist.

## Decision

Odin coordinates specialists through a bounded runtime-owned registry and coordinator. Compact
registry summaries are separate from injected worker handlers. A task specification binds an existing
M2 task to a role, capabilities, a bounded M6-compatible context reference, and explicit repository,
resource, or shared-state ownership claims.

Only dependency-ready `PENDING` tasks in an `EXECUTING` mission can receive assignments. Selection is
deterministic and respects batch, global, and per-specialist concurrency limits. Before any worker is
called, the coordinator reserves a generation-bound expiring lease. Read/read overlap is allowed;
intersecting claims involving a write are deferred. Repository ancestor and descendant paths conflict
conservatively.

Workers receive one immutable assignment and an abort signal. They have no peer messaging, mission
transition, repository, tool, credential, or policy interface. Their structured output is an untrusted
proposal. The coordinator validates exact fields, identity, timestamps, bounds, hashes, uniqueness,
and changed-file ownership. A claimed independent evidence reference counts only when a separately
injected runtime evidence authority attests it; worker labels alone cannot produce acceptance.

Reconciliation emits deterministic `ACCEPTED`, `RETRY_REQUIRED`, or `BLOCKED` data and never mutates
M2 task state. All leases are released after success, malformed output, worker failure, timeout,
cancellation, or expiry. M7 leases are in-memory logical locks scoped to one coordinator process; they
are not distributed or durable worker leases.

## Alternatives

- Let specialists select peers and exchange free-form messages: flexible, but unbounded and difficult
  to audit, budget, interrupt, or secure.
- Run every dependency-ready task concurrently: faster in ideal cases, but ignores shared writes,
  worker capacity, and reconciliation risk.
- Trust a specialist's `VERIFIED` field: simple, but recreates self-certified completion and bypasses
  the M5 evidence principle.
- Build distributed queues, worktrees, and durable leases now: useful for M8, but premature before the
  single-process coordination contract is proven.

## Consequences

Parallelism is conservative: ambiguous ownership serializes work, and missing specs/capabilities or
capacity return typed deferrals. Callers must provide task ownership and a runtime evidence authority
for accepted results. In-memory plan records and leases do not survive restart, and an abort signal
cannot forcibly stop a worker that ignores it; process/worktree isolation and durable recovery remain
M8 work.

## Security impact

Untrusted workers cannot obtain authority through assignment or result objects, self-attest evidence,
report writes outside reserved repository claims, replay released plans, extend leases through clock
rollback, or leak raw thrown errors into reconciliation. Hashes detect in-process envelope tampering
but are not signatures. Logical path locks do not resolve symlinks or replace M3 policy and a future OS
sandbox.

## Verification

M7 tests cover dependency readiness, deterministic selection and hashes, missing specs/capabilities,
batch/runtime/worker capacity, read sharing, repository/resource/state conflicts, cross-plan locks,
expiry and clock rollback, tampered/foreign/replayed plans, immutable assignments, output schema and
ownership rejection, evidence attestation, partial failure, timeout/cancellation release, and a
two-specialist barrier proving concurrent execution.
