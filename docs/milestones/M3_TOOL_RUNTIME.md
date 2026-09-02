# M3 — Tool runtime task contract

Status: implementation verified; final repository checkpoint pending. Updated: 2026-09-02.

## Objective

Build Odin's fail-closed tool control boundary. M3 turns model-proposed tool calls into validated,
permissioned, bounded, auditable execution requests without granting arbitrary host or network access.
It also provides progressively discoverable repository tools behind injected workspace boundaries.

## Acceptance criteria

- Registry exposes compact tool summaries first and full schemas only on explicit resolution. Full
  skill package discovery, installation, testing, and promotion remain M10 work.
- Tool definitions have stable names, versions, risk classes, operations, strict input schemas, retry
  policy, and provenance/trust metadata.
- Input validation fails closed on unsupported schema features, unknown properties, missing required
  fields, invalid primitive types, and invalid bounds before policy or handler execution.
- Capability policy binds mission, task, tool, operation, resource scope, call ceiling, and expiry;
  malformed/missing grants deny by default and high-impact tools require explicit approval evidence.
- Side-effecting tools require an idempotency key. Replaying the same key and input returns the prior
  result; reusing a key with different input fails. Concurrent same-key calls serialize before the
  handler.
- Handler timeout and bounded retry behavior are deterministic. Retryable failures cannot bypass
  policy, call ceilings, cancellation, or idempotency. Side-effecting handlers are single-attempt in
  M3 until worker-level idempotency exists across timeout/crash boundaries.
- Every attempt appends a secret-safe audit record containing policy/result classification, hashed
  input/resource identity, attempt number, timestamps, and side-effect classification.
- Built-in repository search/read/patch/quality tools validate workspace-relative resources and never
  expose arbitrary shell commands. Workspace and quality execution are injected boundaries.
- Tests prove denial, approval, scope escape rejection, schema rejection, replay, concurrent replay,
  retry/timeout, auditing, and repository boundary behavior with no external network calls or paid
  resources.

## Invariants

- Model output is untrusted input; tool calls never execute directly from model payloads.
- Deny is the fallback for missing, expired, exhausted, malformed, or mismatched grants.
- Raw secrets and raw tool inputs are never part of tool definitions, audit records, persisted errors,
  or handler context. Audit records hash resolved resource identities instead of persisting them raw.
- Tool registry metadata is discoverable independently from executable handler objects.
- A filesystem path helper is defense in depth, not a sandbox claim. Real workspace adapters must
  enforce canonical roots and symlink safety at the execution boundary.
- Quality commands are referenced by pre-discovered command IDs; model-provided shell strings are not
  executable commands.
- External network access remains denied in M3. Network-capable tools require a later destination
  policy boundary.

## Out of scope

- Production sandbox/container selection and OS-level isolation.
- Arbitrary terminal/shell execution.
- Network/browser/email/payment/deployment tools.
- Planner/model-driven coding loop (M4).
- Full skill package installation/promotion lifecycle (M10).

## Verification strategy

Run `npm run verify`. M3 tests must cover registry discovery/resolution, strict-schema failures,
capability mismatches and exhaustion, high-impact approval, idempotent replay and conflict, concurrent
same-key execution, timeout, bounded retry, audit records, traversal/absolute-path rejection, patch
boundary forwarding, and quality-command ID enforcement.

Implementation evidence: GitHub Actions run `33675783522` passed on commit
`832e28fcde62ca803cd58cad6cb3ea91c5ff6a89` with 55 tests passed and 0 failed. Aggregate coverage was
85.93% lines, 73.46% branches, and 91.32% functions. That run also verifies the regression fix that
replaced raw audited resource paths with resource hashes.

M3 becomes `VERIFIED` only after the pull-request CI run for the final documentation/export checkpoint
succeeds.
