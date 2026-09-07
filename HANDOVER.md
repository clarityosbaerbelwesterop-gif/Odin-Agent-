# Engineering handover

Updated: 2026-09-07.

## Current delivery state — M23–M25

Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).

- `main` contains verified M0–M22. PR #32 (M20–M22) passed normal exact-head CI run
  `33951326491` before merge.
- Active PR: **#33**, branch `agent/m23-m25-skill-os-memory-tools`, containing exactly M23, M24,
  and M25.
- The binding package contract is
  `docs/milestones/M23_M25_SKILL_OS_ADVANCED_MEMORY_TOOL_ECOSYSTEM.md`.
- M23, M24, and M25 implementation gates are complete. The package hardening run `33954348383`
  passed **427/427 tests**, strict TypeScript, credential-free Kimi dry smoke, and build. Aggregate
  coverage was **90.30% lines / 77.62% branches / 95.75% functions**.
- Warning-clean verification run `33954417440` passed after the adversarial hardening changes.
- Normal PR CI `33954471567` passed on implementation head
  `fddd8518a23782172d6a03fd9e5099839ee3f881` before governance synchronization.
- Governance synchronization is the only repository-local delivery step after that implementation
  evidence. A fresh normal exact-head CI run is required on the final governance head before merge.
- The user has explicitly authorized merge of the completed three-milestone block in the current
  delivery request. Merge still occurs only after final exact-head CI is green.

No live provider/browser/database/cloud/API request, deployment, paid resource, production migration,
billing change, public traffic, or new credential use is part of M23–M25.

## M23 — Skill OS

`src/skill-os` turns already verified M10/M15 capability packs into a runtime-owned selection service.
It does not become a second skill lifecycle authority.

Verified behavior:

- compact pack discovery occurs without loading member instructions;
- selection is deterministic by domain and task class under bounded member/context ceilings;
- every selection binds exact pack id, version, content hash, member identity, and task class;
- task-class scope comes from trusted M15 pack metadata and cannot be caller-relabeled;
- stale, future, changed, revoked, or otherwise unloadable selections fail closed;
- progressive instruction loading re-resolves exact M10/M15 identity before returning content;
- runtime-owned pin/history supports explicit rollback to a previously observed exact revision;
- rollback never activates, promotes, verifies, or otherwise mutates M10 lifecycle state.

M10 remains verification/promotion/activation/revocation authority. M15 remains measured community-pack
evidence authority. M23 cannot register M3 tools, create grants, expose credentials, create memory, or
mint completion/quality/release evidence.

## M24 — Advanced memory

`src/memory/advanced.ts` extends the M6 contract with bounded episodic/project retrieval and
maintenance while preserving current-source precedence.

Verified behavior:

- exact user/project scope isolation and deterministic retrieval/provenance;
- current repository/runtime observations outrank remembered conclusions;
- changed/older remembered conclusions are marked stale rather than silently presented as current;
- conflicting current project-memory conclusions are surfaced as conflicts;
- future-dated current-source or remembered evidence is rejected;
- retention planning is bounded and cannot claim complete coverage from a saturated M6 retrieval
  window;
- deletion delegates to exact M6 tombstones and cannot resurrect an existing memory id;
- compression preserves source record ids/hashes, strongest sensitivity, and lower-authority
  `model_summary` provenance;
- secret-like compression input is rejected;
- a compression proposal must have been issued by the current runtime instance before commit;
- exact compression replay is idempotent and tampered replay fails closed.

Memory remains lower authority than current repository/runtime/task evidence. M24 does not infer durable
user preferences, mint tools/permissions, raise budgets, change routing floors, promote skills, or mark
work complete.

## M25 — Tool ecosystem

`src/tools/ecosystem.ts` adds a typed discovery/catalog layer for repository, browser, database, cloud,
documents, data, CI/CD, API, and research adapters.

Verified behavior:

- each descriptor binds an exact already-registered M3 tool name/version;
- operation, risk, side-effect, timeout, retry, and trust metadata must mirror the M3 manifest;
- cost/network/credential/confirmation metadata is descriptive only and cannot weaken policy;
- compact discovery does not duplicate the full tool schema;
- execution always delegates to `ToolRuntime.execute`;
- M3 therefore retains capability grants, approval checks, idempotency, timeout, retry, cancellation,
  handler dispatch, and audit ownership;
- duplicate identities, unknown categories/tools, descriptor/manifest mismatch, unsafe confirmation
  claims, and side-effecting requests without idempotency fail closed.

M25 contains offline fixture adapters only. It does not prove a real browser/database/cloud/API
integration or authorize any external request.

## Adversarial hardening findings already fixed

The M23–M25 review found two material authority/evidence gaps and closed them before the final package
claim:

1. An M15 pack member could otherwise be relabeled by a caller onto a different task class inside the
   same pack. M23 now derives and validates task scope from trusted pack membership.
2. A deterministic compression hash by itself did not prove that the current runtime had issued the
   proposal. M24 now requires runtime-instance issuance before commit and preserves idempotent exact
   replay.

The same hardening tranche added selection freshness, future-memory rejection, sensitivity monotonicity,
secret rejection, saturated-retention blocking, and additional tamper/bounds regressions.

## Standing authority boundaries

These remain binding for every later milestone:

- M2/M8 durable runtime state, not conversation history or client state, is canonical.
- M3 is the only tool/capability execution authority.
- M5 is completion/evidence authority.
- M6 memory is lower authority than current primary evidence.
- M10 owns skill verification/promotion/activation/revocation.
- M11 quality floors are monotonic and cannot be optimized away.
- M12 sandbox/network/credential boundaries remain fail closed.
- M15 measured pack evidence is required for community capability-pack claims.
- Models, workers, skills, memory, tool descriptors, replay, and clients cannot mint credentials,
  approval, capabilities, budget, quality evidence, completion, or release authority.
- No secrets belong in commits, logs, artifacts, memory, client payloads, or model context.

## Existing evidence that remains deliberately scoped

- M12 is still **PARTIALLY_VERIFIED** for hosted-sandbox and public-production claims. Local sandbox,
  process/network policy, lifecycle contracts, recovery/release evidence, and one bounded live NVIDIA
  Kimi K3 provider path are verified, but that does not prove container/VM isolation or a hosted service.
- Historical M15/M16 Kimi comparisons remain task/profile-specific evidence. They do not establish
  model-wide superiority, universal token savings, AGI/ASI, or equivalence to other named agents/models.
- M20 logical 6 h / 12 h / 24 h soaks use a runtime-owned synthetic clock. They are recovery/integrity
  proofs, not wall-clock hosted uptime claims.
- M22 frontier evaluation fixtures are synthetic offline protocol tests, not a live frontier-model or
  external-agent benchmark.

## Next package after PR #33 merge — M26–M28

The next three-milestone package is:

1. **M26 Production sandbox** — production-grade sandbox contracts for isolated execution, scoped
   filesystem/network/credential access, quotas, timeout, cleanup, secret brokering, and audit evidence.
2. **M27 Hosted mission backend** — durable hosted-service contracts for database/queue/workers,
   authentication, audit, artifacts, realtime reconnect, recovery, idempotency, fencing, backups, and
   failure injection.
3. **M28 Mobile experience** — responsive/mobile/native client protocol and UX contracts for mission
   progress and approvals while canonical long-running compute remains server-side.

Because no hosted sandbox, database, cloud account, production deployment, paid resource, or public
traffic has been authorized by this delivery, M26–M28 must distinguish deterministic/provider-neutral
contract proof from real infrastructure proof. Repository-local implementation may proceed; any live
resource use, deployment, production migration, billing change, or paid action remains separately
approval-gated.

## Exact next steps

1. Finish governance synchronization for PR #33.
2. Obtain one fresh normal exact-head CI run on the final governance head.
3. Merge PR #33 only if that CI is green and the PR remains mergeable.
4. Create the M26–M28 branch from the resulting `main` head.
5. Write the binding M26–M28 contract before implementation, then execute M26, M27, and M28
   sequentially with focused tests, full `npm run verify`, adversarial review, governance sync, and
   exact-head CI.

## M26–M28 handover checkpoint — 2026-09-06

PR #34 (`agent/m26-m28-production-sandbox-hosted-mobile`) now contains the completed repository-local M26–M28 package. M26 production sandbox, M27 hosted mission backend, and M28 mobile experience contracts are implemented and verified without weakening M3/M5/M8/M9/M12 authority boundaries.

Verified evidence before governance synchronization:

- M26 verification/build: run `34019649259`;
- M27 verification/build: run `34019950376`;
- M28 verification/build: run `34020075420`, including 451/451 passing tests and aggregate 90.02% line / 76.97% branch / 95.86% function coverage;
- package-wide authority-boundary CI: run `34020225192` passed.

The source package includes `src/sandbox/production.ts`, `src/hosted/service.ts`, `src/mobile/experience.ts`, their adversarial tests, and a responsive mobile reference fixture. No paid resource, public traffic, production migration, new external credential, live container/microVM/VM execution, or hosted database/queue/auth/realtime proof was used. M26/M27 external proof gates therefore remain open; do not relabel this checkpoint as a production deployment.

Merge gate: after this governance synchronization, require one normal exact-head PR CI success before merging PR #34.

## Intelligence A–C handover checkpoint — 2026-09-07

Current active delivery is PR #35 (`agent/intelligence-a-b-c`), containing exactly **Phase A-last, Phase B,
and Phase C**. `main` already contains the merged M0–M28 repository-local contracts. No new provider or
model integration is part of this tranche; Kimi K3 remains the existing reference identity only.

Verified phase evidence:

- **A-last — evaluation profile envelope:** exact-head CI `34052663699` on
  `8ccd3a55077487d9572e6d0765984d9fd902cf41` passed. Provider/model/profile/reasoning identity,
  capability declarations, context/output ceilings, provenance, and budget compatibility are
  deterministic and hash-bound without model-name capability inference.
- **B — Benchmark 2.0:** exact-head CI `34053195605` on
  `dbd76086073ddddd1167ab8a482279ca32974ace` passed. The locked 100-case blueprint covers coding 25,
  math 20, reasoning 20, tool use 10, research 10, long context 5, recovery 5, and long mission 5 while
  preserving M22 hidden-acceptance separation, matched identity/budgets, and incomplete infrastructure
  semantics.
- **C — weakness mining:** exact-head CI `34090422186` on
  `7856c5c146b86efa12fe74455eafc058cd8ac15a` passed Foundation, Biome, strict TypeScript, **470/470
  tests**, and the credential-free Kimi dry smoke. Typed/hash-bound sanitized diagnostics map into stable
  weakness classes; unknown remains unknown; infrastructure ambiguity stays separate; paired deltas use
  complete measurable arms only and retain incomplete-pair counts. M16 `repair_no_change`,
  `quality_failed_after_repair`, and structured-output/length patterns have regression fixtures.

Package-wide adversarial review after Phase C found no release-blocking authority leak. Benchmark and
weakness output remains lower-authority evidence/data and cannot mint M3 tools/grants, M5 completion,
M10 skill lifecycle, M11/M21 route quality, M12/M26 isolation, credentials, approvals, budgets, or release
claims. Historical Kimi evidence is unchanged. No live provider call, secret use, paid resource,
deployment, production migration, billing action, new credential, or public traffic was introduced.

Current merge gate for PR #35:

1. synchronize `ARCHITECTURE.md`, `SECURITY.md`, `ROADMAP.md`, `HANDOVER.md`, and the binding A–C contract;
2. run one fresh normal exact-head PR CI on that governance head;
3. merge only if that exact-head CI is green and PR #35 remains mergeable. The user explicitly authorized
   this merge on 2026-09-07.

Next package after PR #35 merge is exactly three phases on a fresh branch from the resulting `main` head:

1. **Phase D — intelligence/reasoning amplification**;
2. **Phase E — weak-model amplification**, provider-neutral and with no new model/provider integration;
3. **Phase F — frontier amplification**, evaluation-first and unable to affect routing without separately
   qualified evidence.

D–F must preserve all standing authority boundaries, remain no-new-model/no-live-spend by default, and
receive focused tests, full verification per phase, adversarial review, governance synchronization, and a
fresh exact-head CI before its merge.
