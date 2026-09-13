# PRODUCT M3 — Visible self-maintaining Memory Brain

PRODUCT M3 productizes Odin's existing M6/M24 Memory authority. It does **not** introduce a second
memory engine, a second context compiler, or client-owned memory state. The product graph is a bounded
projection over canonical Memory records, M24 advanced-memory evidence, Workspace sources and runtime
context-selection evidence.

## Objective

Make Odin's durable knowledge understandable and inspectable without weakening its trust boundaries.
A user can see what Odin remembers for a Project, where it came from, whether it is current, conflicted,
archived or low-value, and which exact references were selected into a real Run context.

## Canonical authorities reused

- **Memory record/store:** the M6 `MemoryStore` contract in `src/memory/`.
- **Advanced memory:** M24 `AdvancedMemoryEngine` for current-source comparison, stale/conflict
  classification, retention planning and source-bound compression.
- **Context:** the M6 `DeterministicContextCompiler`.
- **Workspace:** PRODUCT M2 `workspace_files` / `workspace_context_items`.
- **Events:** canonical `odin_api.events`; Brain Pulse is runtime evidence, not client telemetry.
- **Identity:** Neon Auth, transaction-local `odin.user_id`, FORCE RLS.

## Hosted Neon adapter

`NeonMemoryStore` implements the existing `MemoryStore` interface against PRODUCT M3's hosted schema.
Writes preserve canonical kind, scope, provenance, sensitivity, expiry, version and record hashes.
Optimistic version checks and idempotency keys fail closed; a tombstoned ID cannot silently be restored.
Retrieval is bounded and exact user/project scope is enforced both by the adapter and by database RLS.

The persistent tables are:

- `memory_records` — canonical active/tombstoned Memory rows;
- `memory_revisions` — append-only revision evidence;
- `memory_idempotency` — replay/fingerprint protection;
- `memory_product_signals` — bounded product-only usage, pin and archive signals.

Product signals cannot mint provenance, verification, credentials, approvals or tool authority.

## Memory Brain projection

`projectMemoryBrain` deterministically projects canonical records into Project, Memory and source nodes.
It never creates decorative/random memories. Graph size and edge count are bounded. Node status can be:

- `ACTIVE`
- `TEMPORARY`
- `STALE`
- `CONFLICTED`
- `SUPERSEDED`
- `NOISE_CANDIDATE`
- `ARCHIVED`

Sensitive record content is redacted from the graph while safe provenance metadata remains visible.
Duplicate records are represented as superseded/merged evidence rather than silently deleted.

## M24 stale/conflict/retention integration

The product calls the existing `AdvancedMemoryEngine`. Current Workspace observations are supplied with
key, content hash, source version and observation time. M24 therefore remains responsible for deciding
when a Project-memory conclusion is stale compared with a current source, when a newer Project memory
supersedes an older one, and when equally fresh incompatible conclusions conflict.

Retention planning is advisory. The hosted product exposes bounded candidates using a 45-day episodic
and 365-day Project review horizon. It does not automatically delete candidates. A destructive clear
still uses canonical tombstoning with exact version checks.

Compression uses M24's source-hash-bound proposal/commit path. It cannot downgrade sensitivity and
produces lower-authority `model_summary` Project memory. Source records are not automatically deleted.

## Automatic context eligibility

Ordinary hosted Run context excludes memory that is:

- tombstoned;
- expired;
- product-archived;
- sensitive on the ordinary product context path;
- a deterministic noise candidate with no pin/usage protection;
- stale relative to a newer current Workspace source;
- superseded by an equivalent newer record;
- involved in an equally fresh Project-memory conflict.

Current Workspace evidence therefore outranks stale remembered conclusions. Explicit Workspace context
remains P3; eligible Memory is P4. Neither can override P0/P1/P2 policy/task boundaries or grant
permissions.

## Brain Pulse

Brain Pulse is **selected-context evidence**, not chain-of-thought. After the canonical Context Compiler
selects P3/P4 items, PRODUCT M3 persists an integrity-bound `memory.brain.pulse` event containing only:

- selected Memory IDs;
- selected Workspace references;
- the compiler result hash;
- dropped candidate IDs/reasons;
- timestamp and Run/turn binding.

There is no client POST route that can forge Brain Pulse. Selected Memory signals increment usage and
last-used metadata only after canonical compilation.

## Workspace → Memory

Workspace material remains Workspace by default. Promotion is an explicit server-controlled action:

`Workspace item → integrity check → secret-like-content guard → canonical Memory write`

The browser cannot provide `owner_id`, source class, provenance hash or verification state. A cleared
Workspace-backed Memory cannot be silently resurrected under the same ID. Explicit user memories use
`explicit_user` provenance. Secret-like values are rejected from durable product Memory.

## API surface

Authenticated same-origin `/api/memory/*` routes expose bounded product views for:

- graph/search/filter projection;
- M24 stale/conflict evidence;
- record detail with sensitive-content redaction;
- revision history;
- Brain Pulse through the graph projection;
- pin/archive signals;
- advisory retention candidates;
- controlled M24 compression;
- controlled Workspace promotion;
- explicit user Memory writes;
- version-checked clear/tombstone.

Identity and Project ownership always come from authenticated server state and RLS, never request-body
ownership fields.

## Product surface

The Knowledge surface is a real interactive graph. It supports deterministic node placement, pan, zoom,
fit, keyboard node activation, touch interaction, search, kind/status filters, Brain Pulse highlights,
node inspection, relationships, history, pin/archive/clear actions and retention review. The interface
collapses to a focused graph plus bottom-sheet inspector for iPad portrait/smaller layouts and respects
safe areas and reduced motion.

## Security model

Migration `013_product_m3_memory_brain.sql` enables and **forces** RLS, scopes all rows through
`odin_api.actor()`, revokes PUBLIC access and grants only the runtime role. Composite foreign keys bind
records/signals/revisions to an existing owner Project. Mutations require same-origin plus
`X-Odin-Request` CSRF evidence.

The product fails closed for cross-user/project access, malformed provenance, content-hash mismatch,
optimistic-version conflicts, idempotency replay mismatch, secret-like durable writes, forged
compression evidence and unsupported client fields. Product metadata cannot grant tool or credential
authority.

## Verification

PRODUCT M3 verification is the repository's canonical `npm run verify` pipeline:

1. foundation check;
2. Biome quality/format;
3. strict TypeScript;
4. full deterministic TypeScript test suite including M6/M24/PRODUCT M3 memory tests;
5. JSDOM product UI/security regressions;
6. dry provider smoke;
7. production build.

Exact-head GitHub Actions success is required before merge. Preview/live device evidence is recorded
separately and is never inferred from deterministic CI.
