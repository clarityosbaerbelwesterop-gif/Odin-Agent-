# M23–M25 — Skill OS, advanced memory, and tool ecosystem

Status: **VERIFIED_AWAITING_FINAL_EXACT_HEAD_CI**. This document is the binding delivery contract for
one pull request containing exactly three sequential milestones. Checked items require repository
evidence; intent is never marked complete.

## Package objective

Turn the already-verified M10/M15 skill lifecycle, M6 memory contracts, and M3 tool gateway into
higher-level runtime services without moving authority into model output, community content, memory,
or adapter metadata.

1. M23 provides a runtime-owned Skill OS over verified capability packs with compact discovery,
   task-bound selection, progressive instruction loading, exact release identity, and explicit rollback.
2. M24 adds advanced episodic/project retrieval with provenance, stale/current-source precedence,
   bounded retention/deletion, conflict handling, and lower-authority compression.
3. M25 adds a typed tool-ecosystem catalog covering repository, browser, database, cloud, documents,
   data, CI/CD, API, and research adapters while forcing every execution through M3.

## Package invariants

- M3 remains the only tool/capability execution authority. Adapter metadata never creates a grant,
  approval, credential, network scope, or handler.
- M5 remains completion/evidence authority.
- M6 memory remains lower authority than current repository/runtime/task evidence.
- M10 remains skill verification/promotion/activation/revocation authority.
- M15 capability-pack evidence remains required for measured community pack membership.
- M11 quality floors and M12 sandbox/network/credential boundaries remain monotonic and fail closed.
- External/model/tool/community content remains untrusted data.
- No live provider/browser/database/cloud/API request, deployment, paid resource, migration, billing
  change, or public traffic is part of this package.

## M23 — Skill OS

Goal: make verified capability packs practical at runtime without converting skill selection into
lifecycle authority.

- [x] Discover eligible pack metadata without loading member instructions.
- [x] Select exact pack revisions by domain + task class under runtime-owned member/context ceilings
  with deterministic tie-breaking.
- [x] Bind every selection to pack id/version/hash and the exact task class; stale/future/tampered
  selections fail closed.
- [x] Load instructions only after selection and only for exact pack members still resolvable through
  M10/M15 identity checks.
- [x] Bind every member's task-class scope to trusted M15 capability-pack member metadata rather than
  accepting caller relabeling.
- [x] Maintain runtime-owned pin/history for pack routing and support rollback to a previously observed
  exact pack revision without changing M10 lifecycle.
- [x] Prove revoked/unloadable or changed skill content cannot be smuggled through an older selection.

Exit gate: focused tests prove compact discovery, deterministic task selection, progressive loading,
exact identity/task-scope validation, bounded context, selection freshness, explicit pin/rollback
history, and inability to activate/promote/mint tools; full repository verification passes.

## M24 — Advanced memory

Goal: improve project/episodic recall while preserving source authority, deletion semantics, and bounded
maintenance.

- [x] Retrieve only exact user/project scoped episodic/project memory with deterministic ranking and
  explicit provenance.
- [x] Compare matching project-memory keys with runtime-supplied current-source observations; older or
  changed remembered conclusions are marked stale and excluded from authoritative selection.
- [x] Detect conflicting current project-memory conclusions and expose the conflict instead of choosing
  one silently.
- [x] Reject future-dated current-source or remembered evidence relative to evaluation time.
- [x] Provide bounded retention planning and exact tombstone delegation; deletion never resurrects an
  existing memory id and a saturated M6 retrieval window cannot claim complete retention coverage.
- [x] Support bounded compression proposals that preserve source record ids/hashes and produce only
  lower-authority `model_summary` project memory.
- [x] Preserve the strongest source sensitivity during compression, reject obvious secret material,
  and require the exact proposal to have been issued by the current runtime instance before commit.
- [x] Bind deterministic result/maintenance/compression identities to scope, source records, policy,
  and evaluation time; exact compression replay remains idempotent.

Exit gate: focused tests prove current-source precedence, stale exclusion, conflict blocking, temporal
consistency, exact-scope isolation, deterministic retrieval, retention/tombstone behavior, compression
provenance/sensitivity/runtime issuance, replay, and tamper/bounds rejection; full verification passes.

## M25 — Tool ecosystem

Goal: expose a uniform adapter catalog while retaining execution policy, idempotency, approval, timeout,
retry, cancellation, and audit behavior inside M3.

- [x] Define typed adapter categories for repository, browser, database, cloud, documents, data, CI/CD,
  API, and research.
- [x] Require every adapter descriptor to bind an already-registered exact M3 tool name/version and
  mirror its operation, risk, side-effect, timeout, retry, and trust metadata.
- [x] Declare cost/network/credential/confirmation characteristics as metadata only; they cannot weaken
  the referenced M3 manifest or policy.
- [x] Keep discovery compact and deterministic; full tool schema remains resolved from M3 only when
  needed.
- [x] Execute ecosystem requests exclusively by delegating to `ToolRuntime.execute`, preserving M3
  capability grants, approvals, idempotency, cancellation, retry, and audit.
- [x] Reject descriptor/manifest mismatches, duplicate identities, unknown tools/categories, unsafe
  confirmation claims, and side-effecting requests without idempotency.

Exit gate: offline fixture adapters cover all nine categories and prove policy denial/approval,
idempotency replay, retry/timeout metadata preservation, audit delegation, descriptor tamper rejection,
and zero direct adapter authority; full repository verification passes.

## Verified implementation evidence

M23 normal PR CI `33953811462` passed after its focused formatting repair. M23+M24 normal PR CI
`33953969157` then passed full repository verification. M25 normal PR CI `33954155318` passed the
complete pre-hardening package.

Adversarial package review found and repaired two important authority/evidence gaps: a caller could
otherwise relabel an individual M15 pack member onto another task class within the same pack, and a
deterministic compression hash alone was not sufficient evidence that the current runtime had actually
issued the compression proposal. Hardening also added selection freshness, future-memory rejection,
sensitivity monotonicity, secret rejection, saturated-retention blocking, and idempotent compression
replay.

Hardening run `33954348383` passed **427/427 tests**, strict TypeScript, credential-free Kimi dry smoke,
and `npm run build`; aggregate coverage was **90.30% lines / 77.62% branches / 95.75% functions**.
Focused coverage was **91.15% / 71.64% / 94.23%** for Skill OS, **90.91% / 78.03% / 88.46%** for
advanced memory, and **91.36% / 76.39% / 95.00%** for the tool ecosystem.

Clean-warning verification run `33954417440` subsequently passed a warning-free Biome check for the
touched advanced-memory file, full repository verification, and build. Normal PR CI `33954471567`
then passed on implementation head `fddd8518a23782172d6a03fd9e5099839ee3f881`.

## Governance synchronization

- [x] `ROADMAP.md` marks M23–M25 verified, records bounded evidence, and leaves M26–M30 unclaimed.
- [x] `HANDOVER.md` reflects active PR #33, exact evidence, standing authority boundaries, and M26–M28
  as the next package.
- [x] `ARCHITECTURE.md` includes M23 Skill OS, M24 advanced memory, and M25 tool ecosystem in the
  logical architecture/module map without overstating hosted infrastructure.
- [x] `SECURITY.md` records M23/M24/M25 threat boundaries and adds next-package constraints.

Because these governance commits changed the PR head after run `33954471567`, that earlier run remains
valid implementation evidence but is **not** the final merge gate. One fresh normal exact-head CI is
required on the final governance head. Only a green run on that exact head may close this package.

## Explicit non-goals

- No skill auto-installation or auto-activation.
- No arbitrary third-party code execution from skills or tool descriptors.
- No vector database, external embedding service, or durable hosted memory claim.
- No real browser/database/cloud/API adapter call or credential use.
- No production sandbox/backend deployment.
- No capability, completion, quality, release, AGI/ASI, or model-superiority claim may be minted from
  skill, memory, tool metadata, or synthetic fixture evidence.
