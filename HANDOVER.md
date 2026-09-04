# Engineering handover

Updated: 2026-09-04.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- `main` contains verified M0–M11 plus merged M12-A/B at squash merge
  `144e1115196c56e550a5b1da10973fe135d23276`.
- Active branch: `agent/m12c-release-proof`; Draft PR #16 targets `main`.
- M12-C local implementation is repository/CI verified on head
  `5e2a387ca2b2fd4905ac03560df4878be7cda35b`.
- Normal PR run `33796268313` passed **258/258 tests**, 0 failures, with aggregate coverage
  **89.29% lines / 76.24% branches / 95.64% functions**.
- M12 remains **PARTIALLY_VERIFIED** because no authorized live provider/sandbox, production deploy,
  public-service auth/realtime transport, migration, or public traffic proof has been completed yet.
- The user has now explicitly authorized a minimal NVIDIA live-provider smoke run using the existing
  repository secret and requested Kimi K3 if that model is actually available to the key.

## M12-C verified local capability

- bounded structured observability with deterministic event identity and pre-log secret-like metadata rejection;
- immutable hash-bound release evidence and deterministic manifests;
- monotonic `local` / `integration` / `live` evidence levels that cannot be upgraded by relabelling;
- fail-closed release gates for missing/stale/foreign/failed/tampered/duplicate/unreferenced/weak evidence;
- backup manifests and restore verification bound to exact source/restored state hashes;
- deterministic five-scenario recovery proof and conversion to scoped release evidence;
- end-to-end local release proof: repo verify + recovery + restore passes only `local`, while
  `integration` and `live` remain blocked without real higher-level evidence;
- concurrent sandbox release race fixed: identical releases collapse to one remote destroy, conflicting
  release reasons fail closed.

## Boundaries retained

- M3 remains execution/capability authority; M5 remains completion authority.
- M6 memory is still an in-memory contract; M7 ownership is logical single-process coordination.
- M8 durability is local SQLite and does not imply distributed exactly-once effects.
- M9 is a local client protocol/reference shell, not production auth/realtime transport.
- M10 learned/community skills cannot self-promote.
- M11 offline evaluation does not prove live model quality.
- M12 host-process execution is not kernel/container isolation; network policy is not transport-level
  DNS pinning; provider-neutral sandbox contracts are not proof of a hosted sandbox implementation.
- Local fixtures never become integration/live evidence.

## Verified evidence history

- M10 implementation run `33777800516`, 172/172; squash merge
  `bfc76b57a3531f5b6824fa3a3c285c5a55fd13d0`.
- M11 final squash merge `bd9c42a2c07918aed140aebcd0d0d59082a71678`; exact-head CI recorded in merge message.
- M12-A/B normal PR run `33794095989`: 237/237; squash merge
  `144e1115196c56e550a5b1da10973fe135d23276`.
- M12-C normal PR run `33796268313`: 258/258, 89.29% line / 76.24% branch / 95.64% function coverage.

## Exact next action

1. Finish M12-C documentation synchronization and obtain a final normal PR-specific `npm run verify`
   on the exact clean head.
2. Mark PR #16 ready and squash-merge with exact-head protection under the user's standing merge approval.
3. Create a fresh live-evaluation branch from the resulting `main`.
4. Add a narrowly scoped GitHub Actions live-smoke path that reads `NV_API_KEY` only from repository
   secrets, never prints it, discovers/validates the exact NVIDIA Kimi model identifier, and performs one
   low-volume end-to-end task through Odin's provider/runtime boundary.
5. Record latency/usage/output/evidence and score the task against deterministic acceptance criteria. Do
   not claim superiority over GPT-6 Astra/Fable 5.1 unless the same task is actually run against authorized
   comparable baselines; use architecture/eval evidence only for an AGI-bridge assessment.
6. Continue remaining no-cost post-MVP tracks after the live smoke, without deployment, production
   migration, or paid-resource creation beyond this explicitly authorized minimal provider call.
