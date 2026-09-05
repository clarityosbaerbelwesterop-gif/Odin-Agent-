# M23–M25 — Skill OS, advanced memory, and tool ecosystem

Status: **IN PROGRESS**. This document is the binding delivery contract for one pull request containing exactly three sequential milestones. Checked items require repository evidence; intent is never marked complete.

## Package objective

Turn the already-verified M10/M15 skill lifecycle, M6 memory contracts, and M3 tool gateway into higher-level runtime services without moving authority into model output, community content, memory, or adapter metadata.

1. M23 provides a runtime-owned Skill OS over verified capability packs with compact discovery, task-bound selection, progressive instruction loading, exact release identity, and explicit rollback.
2. M24 adds advanced episodic/project retrieval with provenance, stale/current-source precedence, bounded retention/deletion, conflict handling, and lower-authority compression.
3. M25 adds a typed tool-ecosystem catalog covering repository, browser, database, cloud, documents, data, CI/CD, API, and research adapters while forcing every execution through the existing M3 policy/audit runtime.

## Package invariants

- M3 remains the only tool/capability execution authority. Adapter metadata never creates a grant, approval, credential, network scope, or handler.
- M5 remains completion/evidence authority.
- M6 memory remains lower authority than current repository/runtime/task evidence; retrieval cannot relabel remembered conclusions as current facts.
- M10 remains skill verification/promotion/activation/revocation authority. M23 selects only already-loadable exact packages and never activates a skill.
- M15 capability-pack evidence remains required for measured community pack membership. M23 cannot synthesize a passing pack or curation report.
- M11 quality floors and M12 sandbox/network/credential boundaries remain monotonic and fail closed.
- External/model/tool/community content remains untrusted data.
- No live provider call, browser/database/cloud request, deployment, paid resource, migration, billing change, or public traffic is part of this package.

## M23 — Skill OS

Goal: make verified capability packs practical at runtime without converting skill selection into lifecycle authority.

- [ ] Discover eligible pack metadata without loading member instructions.
- [ ] Select exact pack revisions by domain + task class under runtime-owned member/context ceilings with deterministic tie-breaking.
- [ ] Bind every selection to pack id/version/hash and the exact task class; stale/foreign/tampered selections fail closed.
- [ ] Load instructions only after selection and only for exact pack members still resolvable through M10/M15 identity checks.
- [ ] Maintain an explicit runtime-owned pin/history for pack routing and support rollback to a previously observed exact pack revision without changing any M10 lifecycle.
- [ ] Prove revoked/unloadable or changed skill content cannot be smuggled through a previously issued selection.

Exit gate: focused tests prove compact discovery, deterministic task selection, progressive loading, exact identity validation, bounded context, explicit pin/rollback history, and inability to activate/promote/mint tools; full repository verification passes.

## M24 — Advanced memory

Goal: improve project/episodic recall while preserving source authority, deletion semantics, and bounded maintenance.

- [ ] Retrieve only exact user/project scoped episodic/project memory with deterministic ranking and explicit provenance.
- [ ] Compare matching project-memory keys with runtime-supplied current-source observations; older or changed remembered conclusions are marked stale and excluded from authoritative selection.
- [ ] Detect conflicting current project-memory conclusions and expose the conflict instead of choosing one silently.
- [ ] Provide bounded retention planning and exact tombstone delegation; deletion never resurrects an existing memory id.
- [ ] Support bounded compression proposals that preserve source record ids/hashes and produce only lower-authority `model_summary` project memory.
- [ ] Bind deterministic result/maintenance/compression identities to scope, source records, policy, and evaluation time.

Exit gate: focused tests prove current-source precedence, stale exclusion, conflict blocking, exact-scope isolation, deterministic retrieval, retention/tombstone behavior, compression provenance, and tamper/bounds rejection; full repository verification passes.

## M25 — Tool ecosystem

Goal: expose a uniform adapter catalog while retaining all execution policy, idempotency, approval, timeout, retry, and audit behavior inside M3.

- [ ] Define typed adapter categories for repository, browser, database, cloud, documents, data, CI/CD, API, and research.
- [ ] Require every adapter descriptor to bind an already-registered exact M3 tool name/version and mirror its operation, risk, side-effect, timeout, retry, and trust metadata.
- [ ] Declare cost/network/credential/confirmation characteristics as metadata only; they cannot weaken the referenced M3 manifest or policy.
- [ ] Keep discovery compact and deterministic; full tool schema remains resolved from M3 only when needed.
- [ ] Execute ecosystem requests exclusively by delegating to `ToolRuntime.execute`, preserving M3 capability grants, approvals, idempotency, cancellation, retry, and audit.
- [ ] Reject descriptor/manifest mismatches, duplicate identities, unknown tools/categories, unsafe confirmation claims, and side-effecting requests without idempotency.

Exit gate: offline fixture adapters cover all nine categories and prove policy denial/approval, idempotency replay, retry/timeout metadata preservation, audit delegation, descriptor tamper rejection, and zero direct adapter authority; full repository verification passes.

## Verification and delivery

Implement and verify M23, then M24, then M25. Each milestone gets focused deterministic regression coverage. After M25, perform an adversarial diff review, synchronize `ROADMAP.md`, `HANDOVER.md`, `ARCHITECTURE.md`, and `SECURITY.md`, then require one normal exact-head PR CI before merge. Merge remains separately approval-gated.

## Explicit non-goals

- No skill auto-installation or auto-activation.
- No arbitrary third-party code execution from skills or tool descriptors.
- No vector database, external embedding service, or durable hosted memory claim.
- No real browser/database/cloud/API adapter call or credential use.
- No production sandbox/backend deployment.
- No capability, completion, quality, release, or AGI/ASI claim may be minted from skill, memory, or tool metadata.
