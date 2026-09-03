# M6 — Memory and context engine task contract

Status: implementation verified; documentation synchronization pending. Updated: 2026-09-03.

## Objective

Build the smallest coherent knowledge/context slice that reconstructs model context from typed current
state and selectively retrieved memory instead of replaying or destructively summarizing a chat. The
slice must make source precedence, privacy scope, token budgeting, deletion, provenance, snapshots,
and cache invalidation deterministic and independently testable.

The research lesson is explicit: keep small curated memory, progressive retrieval, typed snapshots,
and immutable source references; improve them with scope/version/provenance controls; replace
conversation-as-state and LLM-summary-first compression; avoid stale memory overriding repository
truth, prompt growth, ambiguous token accounting, and database locks across inference calls.

## Acceptance criteria

- Memory contracts distinguish `working`, `episodic`, `semantic`, `project`, and `user_preference`
  records. Procedural skills remain M10 and are not stored as memory.
- Every record has a stable ID/key, user/project/optional mission scope, version, content hash,
  provenance, source version/reference, canonical observation/update times, sensitivity class, tags,
  and lifecycle status.
- Working memory requires an exact mission scope. User preferences require an explicit-user source;
  model-inferred preferences fail closed rather than becoming durable preference state.
- The in-memory contract store supports optimistic versions, idempotent writes, immutable history,
  tombstone deletion, exact-scope retrieval, expiry, and deterministic result ordering. It is a test
  adapter, not a durability claim.
- Retrieval is bounded and lexical/tag-based for this slice. It never crosses user/project scope;
  working memory additionally never crosses mission scope. Unknown/stale/tombstoned records are not
  returned.
- Session snapshots contain mission, decisions, architecture, completed/open work, failed attempts,
  important files, tests, known bugs, constraints, next action, raw-history reference, source event
  version, canonical timestamp, and deterministic hash. Snapshotting never deletes raw history.
- Context candidates use the fixed priority order `P0` system invariants, `P1` current mission, `P2`
  current task, `P3` current repository/code, `P4` observations, `P5` retrieved memory, `P6` history.
- Source class and priority must agree; memory cannot label itself as repository/system context.
  Candidates sharing a semantic key resolve by authority/freshness deterministically, so current
  repository/state sources beat memory and history.
- The compiler owns a deterministic documented token estimate, enforces per-package and total bounds,
  never drops P0–P2 required context, removes lower-priority material first, and throws rather than
  silently exceed a budget that cannot hold required context.
- Compiler output lists selected/dropped IDs, section token estimates, total estimate, source
  fingerprint, and deterministic result hash. It never stores private reasoning.
- A content-addressed in-memory compile cache returns immutable copies, records hits, and misses
  automatically when any candidate content/source version, policy version, or budget changes.
- A context-engine facade combines bounded memory retrieval with trusted current candidates and
  compilation. Current sources remain authoritative over retrieved memory.
- Tests cover scope isolation, explicit preferences, optimistic concurrency, idempotency conflict,
  tombstone/history, expiry, deterministic retrieval, source precedence, priority eviction, required
  budget failure, malformed/tampered input, snapshot determinism, cache hit/invalidation, and the
  retrieval-to-context vertical slice.
- CI remains deterministic and uses no provider, embedding service, external network, database,
  production data, deployment, or paid resource.

## Invariants

- Repository/current source evidence overrides memory when they address the same semantic fact.
- Memory is retrieved evidence, not trusted truth or runtime instruction.
- Raw events/history and artifact sources remain recoverable; summaries and snapshots are derived
  views with provenance and pointers.
- Deletion is explicit and scoped. A tombstoned record cannot reappear through retrieval or cache.
- P0–P2 context cannot be silently sacrificed to fit optional code, observations, memory, or history.
- Context compilation is pure apart from an injected cache; it performs no model, tool, filesystem,
  network, mission-state, or repository mutation.
- Token estimates are labeled estimates. Provider-specific exact tokenization and empirical allocation
  remain later optimization work.

## Out of scope

- SQLite/PostgreSQL durability, encryption-at-rest adapters, backup/restore, retention jobs, or tenant
  administration.
- Embeddings, vector databases, hybrid BM25/vector retrieval, rerankers, or external memory providers.
- Autonomous memory consolidation/dreaming or model-generated summaries.
- Prompt-provider serialization, prompt-cache billing, empirical model routing, or exact
  provider-specific tokenizers.
- Skill storage/promotion (M10), multi-agent shared memory (M7), and distributed cache coherence.
- Destructive compression or deletion of raw mission events and artifacts.

## Verification strategy

Run `npm run verify`. M6 is `VERIFIED` only after local review/repair and both implementation and
synchronized-documentation pull-request CI checkpoints pass. Until then all roadmap claims remain
open.

## Implementation checkpoint

GitHub Actions run `33752964771` passed on implementation commit
`8934e8f3956db0a66528f484faf34a7e8ea92628`: foundation validation, Biome, strict TypeScript, and all
108 tests passed with 0 failures. Aggregate coverage was 88.92% lines, 76.53% branches, and 95.25%
functions. This evidence verifies the implementation; final M6 status remains pending until the
synchronized documentation checkpoint also passes.
