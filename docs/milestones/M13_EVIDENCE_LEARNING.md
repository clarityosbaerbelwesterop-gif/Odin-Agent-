# M13 — Evidence-backed post-task learning and memory curation

Status: **IMPLEMENTATION_VERIFIED_PENDING_FINAL_PR_CI**. Updated: 2026-09-04.

Implementation evidence: helper run `33852005166` passed quality, strict TypeScript, 272/272 tests, and the dry Kimi smoke on corrected head `6165114201d151240125ec890b3560b631f6502b`. Aggregate coverage was 89.42% lines / 76.50% branches / 95.67% functions; `learning/curator` was 91.83% / 80.23% / 96.15%, and the shared secret detector remained 100% / 100% / 100%. The helper removed itself before committing.
Synchronized governance checkpoint before the final normal PR gate: `c1ef3178a805a80ba9ed4f0fbf56b251edaaecd8`.

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
8. Automatic learning rejects obvious secret-like persistent content before evidence lookup or storage;
   the model-provided sensitivity label is not accepted as sufficient proof that content is safe to retain.

## Learning contract

A lesson proposal must bind exact user/project/mission/task scope, a compact lesson, a stable semantic key,
canonical timestamps, source reference, sensitivity, and idempotency key. Before evidence is requested,
M13 computes SHA-256 over the normalized semantic key and exact lesson content. The injected learning-
evidence authority must return a matching PASS attestation bound to:

- exact user/project/mission/task scope;
- exact `learningKeyHash`;
- exact `lessonContentHash`;
- exact sensitivity class;
- a SHA-256 verification-result identity;
- non-empty evidence references.

A PASS for a real task therefore cannot be reused to authorize a different lesson or semantic key.
Support is counted only once per distinct mission/task pair. Replaying the exact proposal is idempotent;
conflicting replay fails closed.

A shared secret-text primitive, also consumed by M12 observability, rejects obvious Bearer/API-key,
GitHub-token, Slack-token, and private-key patterns before persistent learning text enters the learning
authority. The guard covers the normalized semantic key, lesson, source reference, and tags. This is a
fail-closed guard for obvious credentials, not a claim of complete DLP or semantic secret detection.

### Promotion threshold

- 1 verified task: `CANDIDATE`, WARM/tentative.
- 2 distinct verified tasks: still `CANDIDATE`, WARM/tentative.
- 3+ distinct verified tasks with the same scoped key and exact lesson content: `ESTABLISHED`, HOT.
- a different active lesson under the same scoped key creates a conflict; conflicting records cannot be
  committed to memory or emitted as self-nudges.

Only an `ESTABLISHED`, non-conflicted record may be committed to M6 semantic memory. Its provenance is
`verified_learning`, hash-bound to exact lesson content and verification evidence.

## Learned-memory consumption

Persisted `verified_learning` memory is deliberately lower authority than ordinary semantic memory.
General M6 semantic retrieval does not return it. A consumer must explicitly request the normalized tag
`m13-learning`; otherwise the record remains invisible even if text relevance matches. This makes durable
learning opt-in and prevents stale learned heuristics from silently outranking current repository/task
truth. The primary M13 consumption API remains the scoped curator/nudge view.

No context compiler automatically elevates M13 learning into P0/P1 context, and M13 memory never grants
execution authority.

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
- unsupported stale candidates or conflicts below the three-support establishment threshold may be archived after a longer configured age; strongly supported conflicted records remain available for deterministic re-establishment if weaker conflicts are archived;
- established M6 memory is never silently deleted by M13;
- archiving a stale conflicting candidate may allow a sufficiently supported remaining lesson to become
  established on the next deterministic recomputation;
- confirmed user preferences are outside this curator and cannot be inferred, demoted, or deleted here.

## Security tests required

- missing/foreign/FAIL/tampered learning attestation fails closed;
- exact key/lesson hash mismatch fails even when the task verdict is PASS;
- obvious secret-like lesson, key, tag, or source-reference content is rejected regardless of a
  model-provided `internal` label;
- the shared secret detector retains M12 observability rejection behavior;
- duplicate task support cannot inflate confidence;
- exact idempotency replay returns prior state without requiring fresh evidence lookup, while changed input under the same replay key fails closed before evidence lookup;
- three distinct verified tasks are required before semantic-memory commit;
- conflicting lessons under one key block promotion/nudging;
- cross-user/project records are never retrieved or combined;
- learned content cannot become `user_preference` memory;
- memory provenance hash must exactly match lesson content;
- general semantic retrieval excludes `verified_learning` unless `m13-learning` is explicitly requested;
- maintenance never deletes established M6 memory;
- M13 does not create M3 grants/tools or M10 activation authority.

## Acceptance gate

M13 is VERIFIED only when implementation, regression tests, documentation sync, and a normal exact-head
`npm run verify` pass in GitHub Actions. No live provider call is required for this milestone.