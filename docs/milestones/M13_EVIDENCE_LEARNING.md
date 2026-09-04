# M13 — Evidence-backed post-task learning and memory curation

Status: **IMPLEMENTATION_IN_PROGRESS**. Updated: 2026-09-04.

## Objective

Make successful work compound across missions without allowing a model, worker, memory item, or learned
skill to manufacture authority. M13 converts repeated independently verified task outcomes into compact
lower-authority learning records and, only after repeated support, scoped semantic M6 memory.

This milestone is a capability-amplification step. It is not AGI/ASI proof and does not permit recursive
self-modification, autonomous policy changes, tool creation, budget increases, or self-certification.

## External patterns reviewed

M13 is informed by public patterns reviewed on 2026-09-04, without copying or executing third-party code:

- `NousResearch/hermes-agent`: closed learning loop, autonomous skill curation, session recall, context
  compression, scheduled work, subagents, and progressive capability growth.
- `theCAMML/skill-self-improving`: HOT/WARM/COLD memory tiers, repeated-evidence promotion, explicit
  correction signals, conflict handling, compaction, and the rule that silence is not evidence.
- `BerriAI/self-improving-agent`: improvements remain proposals behind an approval/review boundary rather
  than silently rewriting trusted agent behavior.
- `VoltAgent/awesome-openclaw-skills`: broad public skill discovery is useful, but its own security notice
  states that community skills are curated rather than audited. Odin therefore treats discovered skills
  as untrusted research inputs until M10 provenance, hash verification, and trusted promotion succeed.

## Authority boundaries

1. M5 remains completion/evidence authority.
2. M6 remains memory storage/scope authority.
3. M10 remains skill lifecycle/promotion authority.
4. M13 may create learning records and lower-authority memory only.
5. M13 cannot register an M3 tool, mint a capability, alter a mission budget, resolve a provider secret,
   change routing quality floors, mark a task complete, or activate a skill.
6. Model/worker/runtime self-claims do not count as learning support unless an injected M5-backed authority
   returns a matching PASS attestation.
7. Durable user preferences still require explicit-user provenance; M13 never infers them from behavior.

## Learning contract

A lesson proposal must bind exact user/project/mission/task scope, a compact lesson, a stable semantic key,
canonical timestamps, source reference, and idempotency key. The injected learning-evidence authority must
return a matching PASS attestation with a SHA-256 verification-result identity and non-empty evidence refs.

Support is counted only once per distinct mission/task pair. Replaying the exact proposal is idempotent;
conflicting replay fails closed.

### Promotion threshold

- 1 verified task: `CANDIDATE`, WARM/tentative.
- 2 distinct verified tasks: still `CANDIDATE`, WARM/tentative.
- 3+ distinct verified tasks with the same scoped key and exact lesson content: `ESTABLISHED`, HOT.
- a different active lesson under the same scoped key creates a conflict; conflicting records cannot be
  committed to memory or emitted as self-nudges.

Only an `ESTABLISHED`, non-conflicted record may be committed to M6 semantic memory. Its provenance is
`verified_learning`, hash-bound to exact lesson content and verification evidence.

## Self-nudging

M13 may compile bounded compact nudges from non-conflicted verified learning records. Nudges are data, not
instructions or authority. They expose lesson text, support count, tier, confidence, hashes, and evidence
references so the context compiler/runtime can keep them at lower priority than system/mission/task/current
repository evidence.

Nudge retrieval is scope-isolated, deterministic, tag/text aware, and bounded by item and character limits.
No hidden reasoning is stored.

## Curation and decay

Maintenance is deterministic:

- inactive records may cool from HOT/WARM to COLD after a configured age;
- unsupported stale candidates may be archived after a longer configured age;
- established M6 memory is never silently deleted by M13;
- archiving a stale conflicting candidate may allow a sufficiently supported remaining lesson to become
  established on the next deterministic recomputation;
- confirmed user preferences are outside this curator and cannot be inferred, demoted, or deleted here.

## Security tests required

- missing/foreign/FAIL/tampered learning attestation fails closed;
- duplicate task support cannot inflate confidence;
- idempotency conflict fails closed;
- three distinct verified tasks are required before semantic-memory commit;
- conflicting lessons under one key block promotion/nudging;
- cross-user/project records are never retrieved or combined;
- learned content cannot become `user_preference` memory;
- memory provenance hash must exactly match lesson content;
- maintenance never deletes established M6 memory;
- M13 does not create M3 grants/tools or M10 activation authority.

## Acceptance gate

M13 is VERIFIED only when implementation, regression tests, documentation sync, and a normal exact-head
`npm run verify` pass in GitHub Actions. No live provider call is required for this milestone.
