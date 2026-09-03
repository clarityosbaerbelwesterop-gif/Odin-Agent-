# ADR-0007: Source-aware memory and context compilation

- Status: accepted
- Date: 2026-09-03

## Context

Conversation replay and model-generated summaries are not reliable mission state. They grow without
bound, can omit constraints, and can let stale or poisoned content silently override current
repository evidence. A production persistence adapter will also require asynchronous I/O, while
context construction must remain deterministic, budgeted, privacy-scoped, and testable without a
provider call.

## Decision

Odin separates five memory kinds from procedural skills and exposes an asynchronous `MemoryStore`
contract. Records carry exact user/project/optional mission scope, version, provenance, hashes,
canonical timestamps, sensitivity, expiry, and lifecycle state. The M6 in-memory adapter implements
optimistic concurrency, idempotency, metadata-only revision history, bounded lexical/tag retrieval,
and tombstones. Tombstoning removes raw content and content-bearing idempotency replays, invalidates
subscribed context caches, and prevents resurrection under the same stable ID.

Context is compiled from source-labeled candidates in the fixed order P0 system, P1 mission, P2 task,
P3 repository, P4 observation, P5 retrieved memory, and P6 history. Source class and priority must
agree. P0–P2 are mandatory and never silently truncated; optional context is selected
deterministically within explicit item, section, and total budgets. Higher-authority current sources
win semantic collisions over memory/history. Token accounting uses an explicitly approximate,
versioned UTF-8 estimator until provider-specific tokenizers are justified by M11 evidence.

Compile results record selection, drops, estimates, source fingerprint, and result hash. A bounded
content-addressed cache returns defensive copies, misses when source/policy/budget input changes, and
never stores a compilation containing sensitive candidates. Structured session snapshots are derived,
hash-addressed views that retain an exact raw-event-history reference and event version; they never
replace or delete canonical events.

## Alternatives

- Replay the entire conversation: simple initially, but unbounded, expensive, and not a canonical
  recovery model.
- Let an LLM summarize whenever context fills: flexible, but nondeterministic and capable of silently
  losing constraints or amplifying injected content.
- Add embeddings/vector infrastructure now: potentially stronger semantic recall, but adds cost,
  external state, privacy surface, and tuning before bounded lexical retrieval has baseline evidence.
- Use a synchronous store API because M6 is in memory: smaller today, but forces a breaking boundary
  when SQLite/PostgreSQL or remote storage arrives.

## Consequences

Callers must supply provenance-bearing context and await memory/context I/O. Required context can
produce an explicit budget error rather than a partial prompt. Retrieval quality is intentionally
limited to deterministic lexical/tag matching, and the byte-based token figure is an estimate rather
than provider billing truth. Durable storage, encryption at rest, retention workers, semantic search,
distributed cache coherence, and provider prompt serialization remain later work.

## Security impact

Exact scopes and mission-bound working memory reduce confused-deputy leakage. Explicit-user
provenance is required for durable preferences. Memory remains P5 untrusted data and cannot relabel
itself as system, mission, task, or repository context. Tombstones remove raw content from current
state and cached/idempotent replay paths; sensitive candidates bypass the cache. Unkeyed snapshot
hashes detect corruption but do not authenticate storage, so a durable adapter must add access control,
encryption, and authenticated persistence.

## Verification

M6 tests cover write replay/conflict, concurrent versions, scope and mission isolation, explicit
preference provenance, expiry, deletion/non-resurrection, deterministic retrieval, priority/source
validation, current-source precedence, budget eviction/failure, cache behavior, snapshot
determinism/tampering, and the retrieval-to-context vertical slice.
