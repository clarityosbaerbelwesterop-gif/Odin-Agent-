# Engineering handover

Updated: 2026-09-03.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` contains verified M0–M10 at M10 squash merge
  `bfc76b57a3531f5b6824fa3a3c285c5a55fd13d0`.
- Active branch: `agent/m11-adaptive-reasoning`; Draft PR #14 targets `main`.
- M11 core plus the explicit token-budget acceptance fix is verified. Helper verification run
  `33784031658` passed with 199/199 tests, and normal PR run `33784322602` passed after the
  human-authored implementation-evidence checkpoint.
- Roadmap, architecture, security, milestone, and handover are now synchronized to M11. A final normal
  PR-specific `npm run verify` on the synchronized documentation head is required before exact-head
  squash merge.
- The user has explicitly authorized merge after the verified gate and immediate continuation into M12.

## M11 verified capability

M11 adds `src/routing` as a deterministic capability-amplification policy boundary:

- hash-addressed independent/project model-evaluation records bound to exact provider, model, profile
  version, task class, and supported reasoning effort;
- model/runtime/worker self-evaluation, stale/future evidence, tampered hashes, conflicting records,
  unsupported capabilities, and mismatched pricing fail closed;
- capability filtering and a risk/uncertainty-adjusted quality floor execute before cost/latency
  optimization, so a cheaper model cannot win by lowering required quality;
- deterministic primary selection plus stronger eligible escalation routes;
- bounded branch, critique, repair, model-call, parallel-call, estimated-cost, and estimated-token
  ceilings;
- `maxEstimatedTokens` derives a stricter effective model-call ceiling and blocks if even one estimated
  call cannot fit;
- bounded high-risk plans reserve targeted repair capacity before using every remaining call for
  additional critique, preserving repair-before-escalation semantics;
- `AdaptiveReasoningController` can only ACCEPT/CRITIQUE/REPAIR/ESCALATE/BLOCK and requires independent,
  non-contradictory PASS evidence for ACCEPT;
- bounded response-cache metadata is identity/freshness scoped and disabled for sensitive work;
- an offline deterministic eval harness compares small/fast and stronger profiles without provider
  calls or spend.

M11 changes strategy selection only. It cannot mint M3 tool capabilities, manufacture M5 evidence,
claim M7 ownership, promote M10 skills, obtain credentials, increase mission budgets, or deploy anything.

## M11 evidence

Canonical command remains:

```bash
npm ci
npm run verify
```

The first normal M11 implementation run `33782424402` passed with **198/198 tests** and aggregate
coverage **89.98% lines / 76.90% branches / 95.63% functions**. Acceptance review then found that the
ROADMAP promised an explicit token ceiling while implementation had only call/branch/cost ceilings, so
M11 was deliberately not merged.

The token-ceiling tranche introduced `maxEstimatedTokens`. Its first test attempt exposed a fixture
shape issue; the next exposed a real reasoning-plan defect in which four branches plus two critiques
used all six calls and left no targeted repair slot. The implementation was corrected rather than
weakening the test or gate.

GitHub Actions helper verification run `33784031658` then passed the corrected implementation with
**199 tests, 199 passes, 0 failures** and aggregate coverage **90.01% lines / 76.94% branches / 95.63%
functions**. `src/routing/reasoning.ts` reached 94.24% line / 86.67% branch / 100% function coverage.
Foundation validation, Biome, strict TypeScript, and the full repository suite passed.

Normal pull-request CI run `33784322602` subsequently passed on human-authored evidence head
`b002136c43d9ebbe7978e81606bc4f8d9c30eb35`, proving that the clean branch works outside the temporary
helper workflow. The final synchronized documentation head must still receive normal PR CI before M11
is merged.

## Earlier verified evidence

- M0 run `33664864552`.
- M1 run `33667957350`.
- M2 run `33672695583` with 41 tests.
- M3 implementation run `33675783522`; verified merge
  `0a9a76bc7ce2b52e8e879d81d3b261a8168efb29`.
- M4 implementation run `33678970596`; documentation run `33679222149`; merge
  `c60ee329d66511dfbd708176c850557d48e9c9df`.
- M5 implementation run `33724426019` with 77 tests; documentation run `33724647879`.
- M6 implementation run `33752964771` with 108 tests; documentation run `33753281792`; final evidence
  run `33753417686`.
- M7 implementation run `33755851793` with 132 tests; documentation run `33756217402`.
- M8 implementation run `33766277108` with 149 tests; documentation run `33766944528`; merge
  `ce0fdb0454999218d1d1145f406d5165a225e6a8`.
- M9 implementation run `33773644733` with 161 tests; synchronized docs run `33774320732`; merge
  `0d47e31fec79b6341be2ced4b0d67df126eeabe4`.
- M10 implementation run `33777800516` with 172 tests; clean docs run `33780349974`; final evidence
  run `33780616385`; squash merge `bfc76b57a3531f5b6824fa3a3c285c5a55fd13d0`.

CI uses injected provider/tool/worker/skill/routing boundaries and temporary local SQLite stores. M11
used no live provider call, production traffic, public network write, deployment, production migration,
or paid external resource.

## Security and architecture boundaries

- M3 remains the only tool execution/capability authority.
- M5 remains completion authority; routing self-confidence cannot become independent evidence.
- M6 memory remains an in-memory contract; no production vector DB/FTS hybrid is claimed.
- M7 ownership remains logical single-process coordination.
- M8 durability remains local SQLite; no distributed cross-host fencing or exactly-once external effect
  is claimed.
- M9 remains a local client protocol/reference UI proof, not hosted auth/realtime service.
- M10 skill instructions remain procedure only; routing cannot promote or grant a skill.
- M11 evaluations are offline deterministic evidence fixtures, not live-provider benchmark claims.
- No production OS/process/container/worktree sandbox, hardened outbound network broker, live
  MCP/Agent-Skills server, public service/auth/realtime transport, daemon/scheduler, omnichannel
  integration, or live-provider E2E is implemented yet.

## Exact next action

Observe normal PR-specific `npm run verify` on the synchronized M11 documentation head. If green and PR
#14 remains mergeable, mark it ready and squash-merge with exact-head protection under the user's
existing authorization. Then create a fresh M12 branch from the resulting `main` and begin deterministic
local production-hardening work: canonical-root/symlink isolation, bounded process/workspace contracts,
secret-safe environment/output limits, and outbound destination policy tests. Do not perform live
provider calls, deployment, production migration, or paid-resource creation without separate explicit
approval.