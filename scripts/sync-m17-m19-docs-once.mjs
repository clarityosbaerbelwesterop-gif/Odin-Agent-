import { readFile, writeFile } from "node:fs/promises";

function replaceExact(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing governance anchor: ${label}`);
  return text.replace(from, to);
}

async function patch(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`No governance change produced for ${path}`);
  await writeFile(path, after, "utf8");
}

await patch("docs/milestones/M17_M19_RELIABILITY_EFFICIENCY_MULTIFILE.md", (text) => {
  let next = replaceExact(
    text,
    `Status: **IN PROGRESS**. This document is the delivery contract for one pull request containing three
sequentially verified milestones. A checked item requires repository evidence; intent is never marked
complete.`,
    `Status: **VERIFIED_AWAITING_FINAL_EXACT_HEAD_CI**. This document is the delivery contract for one pull request containing three
sequentially verified milestones. A checked item requires repository evidence; intent is never marked
complete.`,
    "milestone status",
  );
  next = next.replaceAll("- [ ] Represent a bounded change set", "- [x] Represent a bounded change set");
  next = next.replaceAll("- [ ] Reject cycles, duplicate ownership", "- [x] Reject cycles, duplicate ownership");
  next = next.replaceAll("- [ ] Stage all changes", "- [x] Stage all changes");
  next = next.replaceAll("- [ ] Restore runtime-trusted preimages", "- [x] Restore runtime-trusted preimages");
  next = next.replaceAll("- [ ] Reconcile non-overlapping specialist proposals", "- [x] Reconcile non-overlapping specialist proposals");
  next = next.replaceAll("- [ ] Integrate M17 recovery decisions", "- [x] Integrate M17 recovery decisions");
  next = next.replaceAll("- [ ] Test the 10-file minimum scenario", "- [x] Test the 10-file minimum scenario");
  next = replaceExact(
    next,
    `Exit gate: a disposable repository fixture completes a verified 10+ file refactor; deliberate mid-apply
and post-apply failures restore the exact original tree; all repository gates pass.

## Verification and delivery`,
    `Exit gate: a disposable repository fixture completes a verified 10+ file refactor; deliberate mid-apply
and post-apply failures restore the exact original tree; all repository gates pass.

M19 implementation evidence: helper run \`33949434835\` passed **379/379 tests**, Biome, strict
TypeScript, credential-free Kimi dry smoke, and \`npm run build\`. Aggregate coverage was **90.31% lines /
77.67% branches / 95.87% functions**; \`runtime/multi-file\` coverage was **86.88% / 75.46% / 95.56%**.
The fixture proves verified 10-file and 100-file boundaries; 101 files, cycles, overlapping/forbidden/
noncanonical paths, stale preimages, and tampered postimages fail before mutation. Partial apply,
post-commit quality/M5 failure, thrown verification paths, and cancellation after mutation restore exact
runtime preimages. Restoration is independently snapshot-hash-bound. Even a misconfigured injected
recovery authority cannot prevent the safety restoration, although the runtime then fails closed instead
of claiming recovery success. The workspace adapter remains an injected transaction contract; this does
not claim filesystem/kernel atomicity for a future production adapter.

## Verification and delivery`,
    "M19 evidence",
  );
  return next;
});

await patch("ROADMAP.md", (text) => {
  let next = replaceExact(
    text,
    `M17 local verification passed with 357/357 tests, Biome, strict TypeScript, credential-free Kimi dry
smoke, and 90.43% line / 77.60% branch / 95.91% function coverage. Exact-head PR CI remains open;
M18 and M19 are not implied complete.`,
    `M17 focused verification passed with 357/357 tests, Biome, strict TypeScript, credential-free Kimi dry
smoke, and 90.43% line / 77.60% branch / 95.91% function coverage. The combined M17–M19 package has
since passed its full implementation helper gate; final exact-head PR CI remains the merge gate.`,
    "roadmap M17 evidence",
  );
  next = replaceExact(
    next,
    `## M19 — Multi-file coding

- [ ] Dependency-aware, ownership-safe change sets spanning 10–100 files.
- [ ] Exact preimage validation, staging, conflict detection, and deterministic reconciliation.
- [ ] Runtime-attested rollback after partial application or failed quality/verification.
- [ ] Verified disposable-repository refactor plus destructive-path regression tests.

The binding M17–M19 exit criteria and non-goals are defined in
\`docs/milestones/M17_M19_RELIABILITY_EFFICIENCY_MULTIFILE.md\`.`,
    `## M19 — Multi-file coding

- [x] Dependency-aware, ownership-safe change sets spanning 10–100 files.
- [x] Exact preimage validation, staging, conflict detection, and deterministic reconciliation.
- [x] Runtime-attested rollback after partial application or failed quality/verification.
- [x] Verified disposable-repository refactor plus destructive-path regression tests.

M19 helper run \`33949434835\` passed 379/379 tests, Biome, strict TypeScript, build, and the
credential-free Kimi dry smoke. Aggregate coverage was 90.31% lines / 77.67% branches / 95.87%
functions. The rollback verifier is bound to the exact runtime-preimage snapshot; restoration still
executes after a partial mutation even if the injected recovery authority does not return ROLLBACK, and
the runtime then fails closed. This proves the injected workspace transaction/rollback contract, not
OS-level filesystem atomicity. Final normal exact-head PR CI remains required before merge.

The binding M17–M19 exit criteria and non-goals are defined in
\`docs/milestones/M17_M19_RELIABILITY_EFFICIENCY_MULTIFILE.md\`.`,
    "roadmap M19",
  );
  return next;
});

await patch("ARCHITECTURE.md", (text) => {
  let next = replaceExact(
    text,
    `## Current module map`,
    `### M17–M19 — Reliability, efficient context, and transactional multi-file coding

\`src/reliability\` makes recovery a runtime-owned deterministic policy. Typed failures map to bounded
retry, repair, alternate-plan, rollback, verifier/model escalation, context reduction, cancellation, or
checkpoint-and-block actions. Budgets and repeated-strategy signatures prevent loops. M17 does not gain
M3 execution authority or M5 completion authority.

M18 extends \`src/context\` with source/profile/policy/verification-bound delta context, semantic reuse,
compact hash-referenced tool summaries, evidence-gated early exit, and risk/budget-adaptive reasoning.
Mandatory P0–P2 context remains present in the effective compiled context, and sensitive material is not
retained for reuse. The measured 99.10% estimate is a deterministic fixture result, not universal or
provider-billed token savings.

M19 adds \`runtime/multi-file\` for bounded 1–100 file change-set DAGs. Runtime canonicalization,
ownership, exact pre/post hashes, dependencies, and M18 context identity are validated before commit.
A trusted workspace adapter stages the full set; quality evidence and M5 verify the resulting tree.
Partial mutation, post-commit quality/verification failure, thrown verification paths, or cancellation
after mutation restore runtime-captured preimages. Restoration deliberately ignores an already-aborted
task signal, is independently bound to the exact snapshot hash, and occurs even if an injected recovery
policy returns an unexpected non-rollback action; that configuration then fails closed after safe-state
restoration. This is an injected adapter transaction contract, not a claim of kernel/filesystem atomicity.

Implementation helper run \`33949434835\` passed 379/379 tests, Biome, strict TypeScript, build, and
credential-free Kimi dry smoke; aggregate coverage was 90.31% / 77.67% / 95.87% and M19 module coverage
was 86.88% / 75.46% / 95.56%. Normal exact-head PR CI remains the final package gate.

## Current module map`,
    "architecture M17-M19 section",
  );
  next = replaceExact(
    next,
    `  runtime/       coding orchestrator, strict plan/repair, verification integration
  verification/  typed evidence verifier and adversarial review authority`,
    `  runtime/       coding orchestrator, strict plan/repair, M19 bounded multi-file coordinator
  reliability/   M17 typed failure classification and bounded recovery policy
  verification/  typed evidence verifier and adversarial review authority`,
    "architecture module map runtime",
  );
  next = replaceExact(
    next,
    `  context/       retrieval facade, P0-P6 compiler/cache, session snapshots`,
    `  context/       retrieval facade, P0-P6 compiler/cache, M18 deltas/efficiency, session snapshots`,
    "architecture module map context",
  );
  return next;
});

await patch("SECURITY.md", (text) => {
  const section = `## Implemented M17–M19 reliability, efficiency, and multi-file safeguards

M17 normalizes failure evidence into bounded categories without persisting raw provider/tool exceptions.
Retry is denied after unknown or irreversible side effects; reversible mutations require runtime-owned
preimage evidence. Recovery budgets and repeated-strategy signatures prevent unbounded retry/repair or
escalation loops. The recovery controller cannot mint M3 grants or M5 completion evidence.

M18 optimization cannot discard mandatory P0–P2 authority context or verification-critical evidence.
Delta/cache identity binds mission/task scope, model profile, policy, stable source identity, and
verification requirements. Sensitive context is excluded from retained reuse. Early exit requires fresh
independent non-contradictory evidence; token reduction never lowers the M11 quality floor.

M19 accepts at most 100 canonical workspace-relative targets and blocks duplicate/ancestor overlap,
forbidden \`.git\`, workflow, dependency, or \`.env\` surfaces, stale preimages, tampered postimages,
cycles, and ownership conflicts before mutation. Runtime-trusted preimages are captured before the
workspace commit boundary. Any partial commit, post-commit verification exception, failed quality/M5
gate, or cancellation after mutation enters fail-closed restoration. Restoration does not inherit an
already-aborted task signal and its independent evidence must match the exact preimage snapshot hash.
Even a misconfigured injected recovery authority cannot prevent restoration once mutation occurred; the
runtime then reports \`ROLLBACK_FAILED\` rather than claiming success. The injected workspace adapter must
supply its own atomic/staging semantics; current tests do not prove OS/filesystem atomicity for a future
production adapter.

Helper run \`33949434835\` passed 379/379 tests with all configured deterministic gates and no live
provider credential/request.

`;
  return replaceExact(text, `## Prompt injection and untrusted-content security`, `${section}## Prompt injection and untrusted-content security`, "security M17-M19 section");
});

await patch("HANDOVER.md", (text) => {
  let next = replaceExact(text, "Updated: 2026-09-04.", "Updated: 2026-09-05.", "handover date");
  const marker = `## Current state\n\n`;
  const current = `## Current state — M17–M19 package\n\n- Active PR: **#31**, branch \`agent/m17-m19-reliability-efficiency-multifile\`, packaging exactly M17, M18, and M19.\n- M17 reliability engine and M18 token-efficiency 2.0 are implemented with focused deterministic evidence; M19 is now implemented and hardened.\n- Final M19 helper run \`33949434835\` passed **379/379 tests**, Biome, strict TypeScript, \`npm run build\`, and credential-free Kimi dry smoke. Aggregate coverage: **90.31% lines / 77.67% branches / 95.87% functions**; M19 module: **86.88% / 75.46% / 95.56%**.\n- M19 proves verified 10-file and 100-file fixture refactors, rejects the 101-file boundary and unsafe/conflicting/stale inputs before mutation, and restores exact preimages after partial apply, post-commit quality/M5 failure, thrown verifier paths, or cancellation after mutation. Restoration is independently snapshot-hash-bound and is not cancelled by the failed task signal.\n- A misconfigured injected recovery authority cannot leave a partially mutated tree merely by refusing ROLLBACK: Odin restores first, then fails closed because policy attestation was unexpected.\n- M18 held-out deterministic fixture remains 50 vs 5,589 estimated context tokens (**99.10% lower**) with verifier parity. This is fixture-bound estimated context, not universal billed-token savings.\n- No live model call, deployment, paid resource, production migration, or public traffic was used for M17–M19.\n- Remaining gate: synchronize governance docs, obtain normal exact-head PR CI on the final user-authored head, then mark PR #31 ready. Merge remains separately approval-gated.\n- The M19 workspace is an injected transaction/staging contract. Do not claim production filesystem/kernel atomicity until a concrete adapter is implemented and independently failure-tested.\n\n`;
  if (next.includes(current)) return next;
  next = replaceExact(next, marker, `${current}${marker}`, "handover current-state prepend");
  return next;
});
