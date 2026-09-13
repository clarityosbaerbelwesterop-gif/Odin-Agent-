# PRODUCT M5 — Skills OS

Status: staging implementation, focused regressions, governance synchronization and canonical verification complete; final PR #80 exact-head CI and merge pending

PRODUCT M5 turns Odin's existing Skill authorities into a usable Skills OS. It does **not** create a
second Skill runtime and it does not let installation become permission authority.

## Canonical authorities

- **M10 Skill Registry** owns normalized Skill packages, content hashes, independent verification,
  lifecycle, promotion, rollback and revocation.
- **M23 Skill OS** owns bounded discovery, deterministic task-class selection, progressive instruction
  loading and selection integrity.
- **M25 Tool Ecosystem / existing tool policy** owns tool, filesystem, repository, network, credential,
  database, deployment, billing and approval authority.
- **PRODUCT M5** owns the user-facing catalog, actor/project-scoped installation state, lifecycle UX,
  connection disclosure, private draft UX and Run Center projection of canonical Skill evidence.

Installing a Skill changes availability only. It grants no tool, network, credential, repository,
filesystem, database, billing, deployment or approval authority.

## Product Skill projection

The Product catalog maps each built-in Product Skill to a real M10-normalized `SkillPackage`. The
Product `contentHash` is the exact M10 package hash rather than a parallel UI hash. Descriptors expose
purpose, publisher, trust, verification state, required tools, required Connections, risk and supported
scope, while the verified procedure stays server-side until M23 actually selects it.

Current first-party Product Skills include Product Planning, Repository Coding, Research & Evidence,
Verification & Review and Workspace Synthesis. The Product layer does not make arbitrary community or
private text executable.

## Installation state

`odin_api.skill_installations` stores actor-scoped installation state with:

- Skill ID, version and exact content hash;
- global or Project scope;
- enable/disable state;
- one verified previous version/hash for explicit rollback;
- install/update timestamps.

Project installations override a same-Skill global installation only inside that Project. Global state
remains actor-scoped and acts as fallback where the Skill supports global scope.

Lifecycle mutations are explicit and optimistic:

`install → enable/disable → update → rollback → remove`

Update binds to the expected current hash. Rollback uses one transaction and restores the exact previous
version/hash while retaining the displaced revision as the next rollback target. Hash mismatch fails
closed instead of applying a partial mutation.

## Project and Run isolation

Project-scoped Skill rows are structurally bound by `(owner_id, project_id)` to the existing canonical
`odin_api.conversations(owner_id,id)` Project authority. PRODUCT M5 creates no second Project table.

Runtime selection verifies that the requested Run belongs to the same actor-scoped Project through the
canonical `turns` authority before discovering or loading a Project Skill. RLS supplies the actor fence;
Project + Run matching supplies the Project fence.

The Run Center Skill evidence endpoint requires both Project and Run, verifies their relationship and
reads only the matching canonical event rows.

## Real M10 → M23 Hosted Run integration

The existing Hosted Run path remains authoritative. PRODUCT M5 extends its bounded context preparation,
not its mission engine:

```text
installed Product Skill
→ M10 SkillPackage identity
→ M23 compact discovery metadata
→ deterministic task-class selection
→ progressive load of the selected package only
→ exact Skill ID + version + content hash + selection hash
→ bounded verified procedure context
→ existing Hosted Run / Mission / Task execution
→ server-side result evidence
```

`NeonChatStore.history()` is the existing context entry point. It adds a verified Skill procedure only
when M23 selected an eligible installed Skill. Every other installed Skill remains metadata and is not
injected into the Run prompt.

The Skill procedure is context, not authority. Repository files, documents and retrieved sources remain
untrusted data, and the procedure cannot expand the independently granted M25/tool capability set.

## Version pinning and resume

A selected Run pins:

- Project ID;
- Run ID;
- Skill ID;
- Skill version;
- M10 content hash;
- M23 selection hash;
- task class and domain.

Resume restores only that exact M10 package revision. If the package version/hash is no longer the same,
Odin fails closed with Skill integrity evidence rather than silently substituting the current catalog
revision.

## Canonical Skill events

Real server/runtime behavior may emit:

- `skill.selected` — M23 selected the exact package;
- `skill.loaded` — the selected verified procedure entered bounded Run context;
- `skill.result` — an actual Run answer/result was associated with the pinned Skill;
- `skill.connection_required` — execution could not proceed because a declared Connection was absent;
- `skill.verification_failed` — the installed revision no longer matched the verified package.

The browser cannot mint these events. Run Center only projects rows already present in the canonical
`odin_api.events` stream.

Canonical Chat events are ordered and paginated by `cursor`, never by an invented Product sequence.

`skill.result` stores bounded metadata and references instead of arbitrary result bodies: Project, Run,
Task, Skill ID, version, content hash, M23 selection hash, verification state, event evidence references
and Artifact references where applicable.

## Connections

Connection requirements are discovered separately from permission authority. Repository Coding requires
a server-side GitHub Connection with a selected repository/default branch. Missing Connection blocks the
Run truthfully and cannot produce a successful `skill.result`.

Connecting GitHub still does not grant writes. Any repository read/write remains subject to the existing
workspace/tool/approval policy.

## Private / Custom Skills

Custom authoring creates only an inert private candidate:

`DRAFT → VALIDATE → VERIFY → optional ACTIVATE`

PRODUCT M5 currently persists the DRAFT boundary. Draft generation accepts a bounded goal, synthesizes a
fixed inert manifest/procedure, rejects obvious secret material and grants no tools or Connections.
User-authored prompt text, publisher claims or fake verification fields do not become M10 authority merely
because a draft was saved.

`odin_api.custom_skill_drafts` is actor/project scoped and structurally bound to the canonical Project
authority for Project rows.

## Database security — migration 014

`migrations/014_product_m5_skills_os.sql` creates only Product installation/draft state. It preserves:

- `ENABLE ROW LEVEL SECURITY`;
- `FORCE ROW LEVEL SECURITY`;
- owner isolation through `odin_api.actor()`;
- `PUBLIC` revocation;
- only bounded `SELECT, INSERT, UPDATE, DELETE` grants to `odin_runtime`;
- composite Project foreign keys to `odin_api.conversations(owner_id,id)`.

It does not create roles, execute grants, credential authority or a parallel Project/Run system.

Migration 014 is repository-verified but was not applied to the canonical production database during
this M5 staging pass. Source verification must not be relabeled as production schema evidence.

## Verified Neon cleanup — migration 015

The canonical Odin Neon project is `cold-mode-01560070`, default branch `production`
(`br-muddy-boat-b1po0mwo`), database `neondb`. Before application, the fresh live M5 audit found exactly
two preserved predecessor tables from the M004 reconciliation:

- `odin_api.github_connections_legacy_v003` — 0 rows;
- `odin_api.oauth_states_legacy_v003` — 0 rows.

For both objects, live FK, user-trigger, dependent-view and routine dependency counts were zero. Their
canonical replacements `odin_api.github_connections` and `odin_api.oauth_states` existed, and repository
runtime search found no query of either legacy name.

`migrations/015_cleanup_legacy_product_control_plane.sql` was then applied to that exact production
branch. Its fail-closed row checks ran first, and the two drops executed without `CASCADE`. The immediate
post-application audit verified both legacy relations are absent while both canonical replacements,
`conversations`, `turns`, `events` and `workspace_files` remain present. A subsequent table audit showed
RLS and FORCE RLS still enabled on every remaining `odin_api` base table.

No other empty table or zero-scan index was removed.

## Security invariants

PRODUCT M5 fails closed for:

- cross-user access through actor RLS;
- cross-Project install/draft/Run access;
- forged Project or Run identity;
- forged Product version/content hash;
- stale optimistic lifecycle mutations;
- missing installation or disabled Skill;
- missing declared Connection;
- pinned resume hash/version mismatch;
- secret-like custom draft content;
- untrusted custom procedure escalation;
- browser-authored Skill evidence;
- undeclared tool/network/credential/database/deployment/billing authority.

Skill installation never bypasses M25/tool permissions, approval gates or verification authority.

## Product surface and responsive behavior

Project → Skills provides searchable catalog cards, trust/status metadata, global/Project scope,
Connection requirements and server-authoritative install lifecycle actions. Private drafts are visibly
inert. Project → Runs adds a `SKILLS USED` section that renders only canonical Skill runtime evidence.

Desktop uses catalog + detail columns. iPad/tablet collapses to one primary detail column while retaining
usable touch targets. Mobile uses one-column catalog/draft layouts and does not rely on `!important`
overrides.

## Verification contract and evidence

Canonical acceptance is the repository-standard `npm run verify`, covering foundation checks, Biome,
strict TypeScript, deterministic domain/security tests, Product/UI tests, provider dry smoke and the
production build. PRODUCT M5 additionally has regressions for:

- exact M10 Product package binding;
- M23 deterministic selection and progressive load;
- Connection blocking;
- Project/Run mismatch;
- disabled/missing/tampered Skill state;
- resume version/hash pinning;
- bounded event metadata without procedure payloads;
- install → update → rollback exact restoration;
- optimistic tamper rejection;
- scoped enable/disable/remove behavior;
- migration FK/RLS/no-CASCADE invariants;
- cursor-ordered Project+Run event projection;
- UI server-authoritative lifecycle wiring and no-evidence rendering.

Staging CI #878 passed the complete repository-standard `npm run verify` on
`8053ae99dbb816d193e8fe3e5346dc73d5fcd2ad`, including Foundation, Biome, strict TypeScript, all 645
deterministic tests, the full UI suite, credential-free provider dry smoke and the production/base build.
After governance synchronization, a fresh exact-head staging success remains required before moving PR
#80. PR #80 then requires its own exact-head GitHub Actions success before merge. Repository tests are not
a claim of Vercel availability or a physical-device session; external preview evidence remains separate.
