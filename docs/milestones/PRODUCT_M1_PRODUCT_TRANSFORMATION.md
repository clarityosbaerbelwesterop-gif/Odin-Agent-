# PRODUCT M1 — Product transformation and foundation

This product milestone is separate from the historical engineering milestone
`M1_PROVIDER_CORE.md`. Historical M0–M28 names and evidence remain unchanged.

## Objective

Turn the existing Odin runtime into the first coherent Personal Agentic Workspace experience without
creating replacement runtime, mission, project, memory, auth, billing, provider, tool or event
authorities.

## Delivered scope

- warm responsive global shell for Home, Projects, Knowledge, Automations, Skills and Activity;
- project navigation for Overview, Workspace, Knowledge, Tasks, Runs and Activity;
- state-backed Companion covering IDLE, UNDERSTANDING, PLANNING, WORKING, VERIFYING, REPAIRING,
  BLOCKED and SUCCESS;
- persistent Projects API as a compatibility projection over Odin's existing conversation repository;
- real three-step plan surfaced from the canonical M2 task DAG;
- human activity labels projected from durable events while retaining raw event data;
- active-project URL restoration and persisted project reopening;
- SCP/BYB migration matrix and credential/integration audit;
- preservation of existing auth, RLS, provider, quota, Stripe, GitHub, memory, skills and verification
  authorities.

## Acceptance evidence

`npm run verify` passed on 2026-09-12. Focused coverage checks project API compatibility, real run
and plan completion, Companion projection, activity projection, persistence/reopening, auth/CSRF,
client navigation and responsive product behavior. Existing hosted Neon integration suites remain the
cross-user RLS evidence; no local fixture is relabeled as live production evidence.

## Limits carried forward

- PRODUCT M1 exposes the boundary for Odin memory but does not build the PRODUCT M3 graph.
- Vercel connection/publish UX and additional Google services remain future scoped adapters.
- Live environment, device/browser and deployment evidence remain separate from deterministic
  repository verification.
- PRODUCT M1 does not claim new model intelligence or benchmark improvement.
