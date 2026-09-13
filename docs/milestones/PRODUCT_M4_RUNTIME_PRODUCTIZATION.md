# PRODUCT M4 — Runtime Productization

Status: implementation branch

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

## Verification

Canonical acceptance is `npm run verify`, including `scripts/run-center-ui.test.mjs`. The focused UI test
covers real project/Run shapes, DAG dependencies, repair/verification evidence, Brain Pulse, Run artifacts,
server-authoritative controls and responsive iPad CSS. Exact-head GitHub Actions success is required before
merge.

Repository tests and responsive CSS are not a claim of a physical iPad session or live production
migration/deployment evidence.
