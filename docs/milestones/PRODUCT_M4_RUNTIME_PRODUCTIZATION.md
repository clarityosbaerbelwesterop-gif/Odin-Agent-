# PRODUCT M4 — Runtime Productization

Status: implementation and regression hardening complete; final governance synchronization and exact-head merge gate pending

PRODUCT M4 does **not** introduce a second Odin runtime. The mission runtime, task graph, controls,
tool authority, verification authority, recovery semantics, approvals, Workspace context and Memory
context already exist in Odin. PRODUCT M4 makes those existing authorities understandable as a coherent
Run Center.

## Reused authorities

- M2 mission runtime owns state, tasks, dependencies, budgets and transitions.
- M3 owns tool execution authority and audit.
- M5 owns completion/verification evidence.
- M6/M18/M24 plus PRODUCT M2/M3 own compiled Workspace and eligible Memory context.
- M8/M20 own checkpoint/recovery semantics.
- M10/M23/M25 remain the Skill/tool catalog authorities; PRODUCT M4 only displays evidence it can bind.
- existing Odin Bot autonomy/approval infrastructure remains approval authority; the Run Center cannot
  create or forge an approval.
- hosted `ChatEngine` and canonical project/turn/event APIs remain the source of Run state.

## Product surface

Project → Runs opens a dedicated Run Center. It projects:

- Run history and current goal/state;
- the canonical task DAG and real `dependsOn` edges;
- current Companion state;
- real tool/model/file/runtime activity;
- quality, independent review and verification evidence;
- repair cycles derived from failed evidence and DIAGNOSING/REPAIRING states;
- token/call/tool usage where the runtime actually reports it;
- checkpoint/recovery evidence only when corresponding runtime events exist;
- approvals only when approval events exist;
- actual Context Compiler selections through PRODUCT M3 Brain Pulse;
- Run-linked PRODUCT M2 Workspace Artifacts;
- pause/resume/cancel with fresh server versions;
- a replan request as a normal steering instruction, leaving the runtime authoritative.

Missing evidence is rendered as missing/pending. The client must not invent a completed check, approval,
checkpoint, Skill use, cost or deployment.

## No chain-of-thought

The Run Center exposes observable actions and evidence, not hidden model reasoning. Brain Pulse means
selected context. Activity means emitted runtime/tool/evidence events. Neither is a reasoning trace.

## Responsive contract

Desktop keeps Run history beside the selected Run. On tablet/iPad the history becomes a horizontal,
touch-friendly strip and the detail surface becomes a single reading column. Mobile keeps controls,
verification and evidence legible without presenting a miniature IDE.

## Security invariants

- Controls call the existing server-authoritative turn control endpoint with the current runtime version.
- Replan is steering input, not a client-authored task graph mutation.
- Run data is obtained only through tenant/project-scoped APIs.
- The browser cannot create verification evidence, approvals, tool grants or completion state.
- Missing evidence remains missing.
- Context and Memory references are observations from the Context Compiler/Brain Pulse, not authority.
- Run-linked Workspace Artifacts keep the existing same-owner/same-project provenance checks.
- Activity is a bounded projection of canonical events; it cannot expose credentials or become authority.

## Adversarial regression mapping

PRODUCT M4 relies on the existing canonical security suites rather than duplicating security engines.
The full repository gate covers the required attack classes through these existing boundaries:

- cross-user and cross-project access: Memory scope isolation, hosted exact tenant/project/mission scope,
  Workspace project-scoped search/context and client capability scope tests;
- forged Run/task state and invalid pause/resume/cancel: M2 closed transitions, optimistic mission versions,
  stale-control rejection and exact client command schemas;
- forged verification/approval: M5 foreign/stale/self-authored evidence rejection and M3 matching approval
  requirements for high-impact tools;
- forged usage/provenance/Brain Pulse: server-derived product projections, same-project Artifact provenance,
  Context Compiler integrity checks and PRODUCT M3 server-projected Brain Pulse tests;
- secret leakage: input/output secret rejection, secret-safe runtime events and credential/control-plane
  redaction tests;
- sensitive Memory leakage: exact user/project Memory isolation, sensitivity-preserving context compilation
  and sensitive-context cache exclusion;
- undeclared tool/network/credential authority: M3/M12/M25 fail-closed capability, network, credential and
  adapter policy tests.

`scripts/run-center-ui.test.mjs` additionally proves that the M4 browser surface uses real task
relationships/evidence/context, fetches a fresh server version before controls, represents replan as
steering, and contains no private-reasoning projection. The M3 UI regression harness was hardened to
wait for the actual asynchronous server-projected graph instead of relying on event-loop ordering.

## Verification

Canonical acceptance is `npm run verify`, including `scripts/run-center-ui.test.mjs`. The focused UI test
covers real project/Run shapes, DAG dependencies, repair/verification evidence, Brain Pulse, Run artifacts,
server-authoritative controls and responsive iPad CSS. Exact-head GitHub Actions success is required before
merge.

On CI #858, foundation, Biome, strict TypeScript and all **627/627** deterministic domain/security tests
passed. All three PRODUCT M4 UI regressions passed. The gate then exposed one timing-sensitive PRODUCT M3
UI assertion (43/44 UI tests); commit `f8d45b5581d954bc872cc8f9a18d75eb21bf9aa0` hardens that regression
without weakening its server-projection assertions. A fresh exact-head CI run remains the authoritative
merge evidence.

Repository tests and responsive CSS are not a claim of a physical iPad session or live production
migration/deployment evidence. Preview/deployment evidence remains separate and must not be fabricated
when an external provider is rate-limited or unavailable.
