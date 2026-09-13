# PRODUCT M2 — Persistent Workspace OS

PRODUCT M2 continues directly from PRODUCT M1 / PR #76. It does not replace the project/conversation,
mission, artifact/workspace, event, authentication, context or verification authorities established by
Odin's engineering milestones.

## Objective

Turn an Odin Project from a chat with a title into a durable place where project work can be created,
reopened, searched, selected as context, traced back to Runs and previewed safely.

## Canonical authorities reused

- **Project:** `odin_api.conversations` and the existing ChatRepository projection.
- **Workspace / Artifact:** the existing `odin_api.workspace_files` table. M2 extends this table instead
  of creating `ProductArtifact` or a second artifact database.
- **Run:** existing turns plus canonical mission/event state.
- **Activity:** existing `odin_api.events`; Workspace actions outside a Run use `turn_id = NULL`.
- **Context:** the existing M6 `DeterministicContextCompiler`.
- **Preview:** the existing isolated static preview implementation.
- **Identity:** Neon Auth plus transaction-local `odin.user_id` and FORCE RLS.

## Workspace item model

`workspace_files` gains a stable `item_id`, bounded `kind`, title/MIME metadata, `origin`, optimistic
`version`, provenance (`source_turn_id`, `source_task_id`), metadata and timestamps. Existing runtime
files are backfilled with IDs and remain the same canonical rows.

Supported product kinds are bounded to:

`DOCUMENT`, `NOTE`, `TEXT`, `MARKDOWN`, `CODE`, `HTML`, `JSON`, `IMAGE_REFERENCE`,
`FILE_REFERENCE`, `GENERATED_ARTIFACT`, `RESEARCH_RESULT`, `PLAN`, and `REPORT`.

Origins are server-controlled `user`, `runtime`, or `import`. The document endpoint never accepts a
client-supplied origin, Run provenance or verification state. A generated Run Artifact can only be
created by resolving a canonical Run and integrity-protected `answer` event in the same Project.

## Documents and conflict model

User documents are durable server rows. Updates require `expectedVersion`; a mismatch returns
`STALE_DOCUMENT` instead of overwriting newer state. The product only displays **Saved** after the
server acknowledges the mutation. Generated runtime Artifacts are immutable through the document
endpoint.

The client keeps unsaved editor text in the active DOM during a conflict and asks the user to reload
before a later save. Collaborative CRDT editing is intentionally out of scope.

## Import boundary

M2 accepts bounded text-oriented imports only: plain text, Markdown, HTML, CSS, JavaScript and JSON.
JSON is parsed before persistence. Filenames are Unicode-normalized, path separators/control characters
are removed, traversal prefixes are stripped, and imported content remains data: it is never executed
as trusted code. Binary upload is not claimed.

## Project Context and Run integration

`workspace_context_items` stores references to canonical Workspace items, not copied prompts. The
composite owner/project/item foreign key prevents attaching another Project's item.

On a new hosted Run, selected resources are loaded under the authenticated actor and compiled through
M6's `DeterministicContextCompiler`:

- P0 — Workspace trust policy;
- P1 — current Project boundary;
- P2 — current Run/task usage rule;
- P3 — explicitly selected Workspace resources.

P3 content is labelled untrusted project data. It cannot grant tool permissions, mint approvals,
change budgets, bypass verification or sandbox rules. The compiler enforces item/section/total token
bounds and content integrity before the selected P3 projection is added to the Run's initial model
history. Odin does **not** serialize the entire Project into every model request.

## Layout continuity

`workspace_layouts` persists only useful continuity: at most 12 open canonical item IDs, the active item,
a version and update time. It does not persist transient drawer animation/panel state. Layout writes are
optimistically versioned and reject references to missing Project items.

## Search

M2 search is authenticated, owner-scoped and Project-scoped. It searches bounded Workspace rows by
title, path and supported textual content, ordered by recent update and capped at 200 results. It is not
a global semantic-search platform.

## Preview boundary

HTML artifacts continue through Odin's existing preview assembler/endpoint and render in an iframe with
`sandbox="allow-scripts"` without `allow-same-origin`. Preview content receives no Odin credentials,
parent privileges or secret material. Plain text/JSON/Markdown remain non-privileged Workspace content.
Preview is explicitly distinct from deployment or publication.

## RLS and authorization

Migration `012_product_m2_workspace_os.sql` extends the existing table and creates context/layout tables
with owner/project composite foreign keys, `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`,
canonical `odin_api.actor()` policies, PUBLIC privilege revocation and explicit `odin_runtime` grants.
Server routes derive identity from Neon Auth; they never trust browser-provided `userId`, `ownerId` or
Workspace ownership fields. Same-origin and `X-Odin-Request` CSRF gates apply to Workspace mutations.

## Product surface

The Project Workspace uses a calm three-part model on desktop: Resources, Work Surface and Context /
Companion. Resources collapse to a drawer and Context to a secondary panel on iPad-size layouts. Tabs
are touch usable, keyboard switchable, overflow horizontally and restore from canonical layout state.
Reduced-motion and safe-area behavior are retained.

## Limits and non-goals

- 200 Workspace rows and 10 MB total textual Workspace content per Project in the current hosted path;
- individual document/import requests are bounded to 256 KiB;
- at most 16 explicit Project Context items;
- at most 12 persisted open tabs;
- no binary storage claim;
- no collaborative editor;
- no production deployment claim from Preview;
- no automatic conversion of Workspace documents into permanent Memory (PRODUCT M3 owns that policy);
- no coding IDE/terminal/Git productization (later product milestone).

## Verification policy

Repository verification is `npm run verify`: foundation, Biome quality/format, TypeScript, the complete
deterministic test suite, UI tests, dry provider smoke and production build. Live Vercel/browser/device
evidence is recorded separately and is never inferred from deterministic CI.
