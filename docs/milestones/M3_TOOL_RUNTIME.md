# M3 — Tool runtime task contract

Status: implementation in progress. Updated: 2026-09-02.

## Objective

Build Odin's fail-closed tool control boundary. M3 turns model-proposed tool calls into validated,
permissioned, bounded, auditable execution requests without granting arbitrary host or network access.
It also provides progressively discoverable repository tools behind injected workspace boundaries.

## Acceptance criteria

- Registry exposes compact tool/skill summaries first and full schemas only on explicit resolution.
- Tool definitions have stable names, versions, risk classes, operations, strict input schemas, retry
  policy, and provenance/trust metadata.
- Input validation fails closed on unsupported schema features, unknown properties, missing required
  fields, invalid primitive types, and invalid bounds before policy or handler execution.
- Capability policy binds mission, task, tool, operation, resource scope, call ceiling, and expiry;
  malformed/missing grants deny by default and high-impact tools require explicit approval evidence.
- Side-effecting tools require an idempotency key. Replaying the same key and input returns the prior
  result; reusing a key with different input fails.
- Handler timeout and bounded retry behavior are deterministic. Retryable failures cannot bypass
  policy, call ceilings, cancellation, or idempotency.
- Every attempt appends a secret-safe audit record containing scope, policy decision, input hash,
  result class, attempt number, timestamps, and side-effect classification.
- Built-in repository search/read/patch/quality tools validate workspace-relative resources and never
  expose arbitrary shell commands. Workspace and quality execution are injected boundaries.
- Tests prove denial, approval, scope escape rejection, schema rejection, replay, retry/timeout,
  auditing, and repository boundary behavior with no external network calls or paid resources.

## Invariants

- Model output is untrusted input; tool calls never execute directly from model payloads.
- Deny is the fallback for missing, expired, exhausted, malformed, or mismatched grants.
- Raw secrets are never part of tool definitions, audit records, persisted errors, or handler context.
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
capability mismatches and exhaustion, high-impact approval, idempotent replay and conflict, timeout,
bounded retry, audit records, traversal/absolute-path rejection, patch boundary forwarding, and
quality-command ID enforcement.

M3 is `VERIFIED` only after the pull-request CI run for its final commit succeeds.