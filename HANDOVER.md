# Engineering handover

Updated: 2026-09-03.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` currently contains verified M0–M11 at M11 squash merge
  `bd9c42a2c07918aed140aebcd0d0d59082a71678`.
- Active branch: `agent/m12-production-hardening`; Draft PR #15 targets `main`.
- M12-A/B local hardening and the provider-neutral sandbox lifecycle are repository/CI verified.
- Normal PR run `33794095989` passed on human-authored head
  `661510592ffa7e9c2370d8d0097f8355ea9f34fc` with **237/237 tests**, 0 failures, and aggregate coverage
  **89.43% lines / 76.28% branches / 95.37% functions**.
- M12 remains **PARTIALLY_VERIFIED**. No hosted sandbox provider, live model provider, deployment,
  production migration, public traffic, billing, or paid resource was exercised.
- The user has explicitly authorized merging verified work and immediate continuation into remaining
  milestones/tranches.

## M12-A/B partially verified capability

M12 currently adds a fail-closed local execution and sandbox-selection boundary:

- canonical workspace root plus `realpath`/symlink escape enforcement for read, write, and cwd;
- rejection of lexical traversal, absolute-path ambiguity, NUL/backslash ambiguity, and root-prefix
  confusion;
- stable trusted command IDs only, `shell: false`, runtime-owned executable/arguments, explicit
  environment inheritance, concurrency ceilings, timeout/cancellation, and independent bounded
  stdout/stderr;
- process concurrency is reserved before asynchronous cwd resolution and released through `finally`,
  preventing the race discovered during M12 testing;
- outbound HTTPS/host/port/address policy with injected DNS evidence, private/reserved address denial,
  and destination/redirect re-authorization;
- exact `provider + model + profileVersion` binding to a sandbox backend;
- provider credentials resolve with exact provider/model context; sandbox credentials remain behind
  runtime-owned `credentialRef`s and are not exposed to model, worker, client, or public metadata;
- M11 routing decisions deterministically select the corresponding sandbox backend for primary or
  escalation routes;
- remote sandbox allocation uses deterministic idempotency keys, collapses concurrent identical
  creates, rejects conflicting replay, requires `destroy`, and provides replay-safe cleanup;
- released sandbox allocations cannot silently become usable again;
- optional provider expiry metadata is validated when present and structurally omitted when absent.

This is a provider-neutral contract and bounded host-process boundary. It is **not** proof of a
specific hosted sandbox API, kernel/container isolation, transport-level DNS pinning, or production
readiness.

## M11 verified capability retained beneath M12

M11 remains the adaptive model/reasoning policy boundary:

- hash-addressed independent/project evaluation records bind exact provider, model, profile version,
  task class, and supported reasoning effort;
- stale/future/self-authored/tampered evidence fails closed;
- capability filtering and risk/uncertainty-adjusted quality floors run before cost/latency
  optimization;
- deterministic primary selection and bounded stronger escalation routes;
- bounded branch, critique, repair, model-call, parallel-call, estimated-cost, and estimated-token
  ceilings;
- `AdaptiveReasoningController` accepts only with independent non-contradictory PASS evidence;
- response-cache metadata is identity/freshness scoped and sensitive work disables caching;
- offline evaluation compares small/fast and stronger profiles without live provider spend.

M12 consumes M11 route identity but does not let routing mint M3 tool capabilities, manufacture M5
evidence, claim M7 ownership, promote M10 skills, expand budgets, or expose credentials.

## Verified evidence history

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
- M11 final squash merge `bd9c42a2c07918aed140aebcd0d0d59082a71678`; merge message records exact-head CI
  `33784885858`.
- M12-A/B implementation/lifecycle normal PR run `33794095989`: 237/237 tests, 0 failures,
  89.43% line / 76.28% branch / 95.37% function coverage.

CI uses injected provider/tool/worker/skill/routing/sandbox boundaries and temporary local SQLite
stores. M12-A/B used no live provider call, hosted sandbox call, deployment, production migration,
public traffic, billing change, or paid external resource.

## Security and architecture boundaries

- M3 remains the only tool execution/capability authority.
- M5 remains completion authority; routing or sandbox success cannot become independent evidence.
- M6 memory remains an in-memory contract; no production vector DB/FTS hybrid is claimed.
- M7 ownership remains logical single-process coordination.
- M8 durability remains local SQLite; no distributed cross-host fencing or exactly-once external effect
  is claimed.
- M9 remains a local client protocol/reference UI proof, not hosted auth/realtime service.
- M10 skills remain procedure only; learned/community packages cannot self-promote.
- M11 evaluations remain offline deterministic evidence fixtures, not live-provider benchmarks.
- M12 host-process execution is not a kernel/container sandbox; outbound policy is not transport-level
  DNS pinning; the remote sandbox interface is provider-neutral and injected, not live-provider proof.
- No production public service/auth/realtime transport, distributed worker fleet, live MCP gateway,
  production backup service, or live-provider E2E is verified yet.

## Exact next action

1. Finish synchronizing M12-A/B documentation and obtain a final normal PR-specific `npm run verify`
   on the exact clean head.
2. If PR #15 remains mergeable, mark it ready and squash-merge with exact-head protection under the
   user's authorization.
3. Create a fresh branch from the resulting `main` for **M12-C**.
4. Implement no-cost M12-C work: structured secret-safe observability, deterministic load/recovery
   fixtures, backup/recovery contracts, release-evidence manifests, and fail-closed release gates.
5. Do not perform live provider/sandbox calls, deployment, production migration, public traffic,
   billing changes, or paid-resource creation without separate explicit approval.
