# Claude contributor entry point

Read `AGENTS.md`, `ARCHITECTURE.md`, `SECURITY.md`, `ROADMAP.md`, and `HANDOVER.md` before editing.
Their constraints are binding. Do not infer completion from generated code: run `npm run verify`,
map acceptance criteria to evidence, update the handover, and report any waived gate explicitly.

The active architectural principle is **zero unverified changes**. Keep changes narrow and prefer
deterministic evidence from compilers, tests, policy checks, and runtime observations over model
self-assessment.
