import { readFile, writeFile } from "node:fs/promises";

async function replaceSection(path, startMarker, endMarker, replacement) {
  const text = await readFile(path, "utf8");
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Missing section marker in ${path}`);
  await writeFile(path, `${text.slice(0, start)}${replacement.trimEnd()}\n\n${text.slice(end)}`, "utf8");
}

await replaceSection(
  "ROADMAP.md",
  "## M15 — Curated capability pack and offline improvement evaluation",
  "## Post-MVP capability track",
  `## M15 — Curated capability pack and offline improvement evaluation

- [x] Runtime-owned procedure catalogs deduplicate candidate behavior against canonical Odin M2/M4/M5/M7/M10/M11 behavior before evaluation.
- [x] Exact candidate name/version/content hash, domain, task classes, context bounds, trusted runtime time, and independent evidence are validated fail-closed.
- [x] Paired held-out curation fixtures enforce quality floors, safety/authority PASS, token/latency ceilings, minimum average lift, deterministic report identity, and no M10 activation.
- [x] Progressive capability-pack registry accepts only exact VERIFIED/ACTIVE community members whose M10 verification is bound to the same integrity-valid passing M15 evidence; discovery stays compact.
- [x] Odin-owned coding, research, security, product/business, and marketing procedure drafts preserve existing M3/M5/M6/M10/M11 authorities; unproven data/documents remains absent.
- [x] Bounded offline replay emits only KEEP/RETEST/COMPRESS/DEDUPLICATE/REVIEW proposals and has no skill, memory, tool, credential, budget, or completion mutation interface.
- [x] Confirmed hardening regressions cover stale-evidence rescue, future caller timestamps, self-declared procedure novelty, forged/mismatched pack evidence, and fail-closed live A/B arm failures.
- [ ] Record the first real post-merge bare-model-vs-Odin provider A/B evidence and populate a measured pack only if the candidate passes the same quality/safety/authority gates.

Implementation verification helper run \`33866236138\` passed **319/319 tests**, Biome, strict TypeScript, and secret-free Kimi dry smoke after the final curation/A-B hardening. Aggregate coverage was **89.81% lines / 77.03% branches / 95.85% functions**. \`capability-packs/curator\` reached **95.48% / 81.05% / 97.22%**, registry **90.43% / 77.88% / 95.24%**, and replay **92.86% / 89.74% / 100%**. A normal synchronized exact-head PR CI remains required before merge. No distilled candidate is ACTIVE and no broad model-quality claim is made from contract tests.`,
);

{
  const path = "ARCHITECTURE.md";
  let text = await readFile(path, "utf8");
  const anchor = "## Current module map\n";
  if (!text.includes("### M15 — Curated capability packs and measured procedure intake")) {
    const block = `### M15 — Curated capability packs and measured procedure intake

\`src/capability-packs\` adds a lower-authority curation layer above M10. Candidate identity is bound to exact package hash, domain, bounded task classes, runtime-owned procedure keys, context ceilings, and a trusted runtime clock. Fully redundant procedures stop before evaluation. Unknown/self-declared procedure keys, stale/future/foreign evidence, and model/runtime/worker self-evaluation fail closed.

Passing reports are deterministic and hash-addressed. They may produce M10 verification for the exact community candidate but never activation. Progressive packs require the same passing report evidence to match M10 lifecycle history and expose compact metadata only; full instructions still resolve through M10. Offline replay is proposal-only and receives no M3/M5/M6/M10 mutation authority.

The live comparison harness is separate from curation authority. It compares the same Kimi K3 coding cases with and without an evaluation-only candidate overlay, caps provider calls, sanitizes evidence, and records failed/interrupted arms as explicit negative measurements instead of dropping them. This supports task-specific lift measurement; it does not turn an orchestration result into a model benchmark or AGI claim.

Implementation verification helper run \`33866236138\` passed 319/319 tests with 89.81% line / 77.03% branch / 95.85% function coverage after trusted-clock, procedure-catalog, and A/B failure-evidence hardening. Final normal exact-head CI is still required before merge.

`;
    if (!text.includes(anchor)) throw new Error("ARCHITECTURE current module map marker missing");
    text = text.replace(anchor, block + anchor);
  }
  text = text.replace(
    "  skill-intake/  M14 immutable community-skill intake, bounded risk/completeness quarantine\n",
    "  skill-intake/  M14 immutable community-skill intake, bounded risk/completeness quarantine\n  capability-packs/ M15 measured procedure curation, progressive packs, proposal-only replay\n",
  );
  const oldNext = `Local CI may never manufacture \`integration\` or \`live\` evidence. Any paid resource, deployment, or
production/public traffic remains separately approval-gated. With M14 implementation verified, the next no-cost capability milestone after merge is M15: evaluate and deduplicate community procedures against Odin's canonical runtime on held-out fixtures, measure output lift/safety/context cost, and promote only measured winners through M10. M15 may propose progressively loaded capability packs but cannot turn external instructions into authority or self-promote them.`;
  const newNext = `Local CI may never manufacture \`integration\` or \`live\` evidence. Any paid resource, deployment, or
production/public traffic remains separately approval-gated. M15's curation, progressive-pack, and proposal-only replay boundaries are implementation-verified and awaiting normal exact-head CI before merge. After merge, one user-authorized bounded Kimi K3 bare-model-vs-Odin A/B may record task-specific lift; only a passing exact-hash result may become measured M10 verification/pack evidence. Broader provider or public-benchmark claims require their own matched evaluations.`;
  if (text.includes(oldNext)) text = text.replace(oldNext, newNext);
  await writeFile(path, text, "utf8");
}

{
  const path = "SECURITY.md";
  let text = await readFile(path, "utf8");
  const anchor = "## Prompt injection and untrusted-content security\n";
  if (!text.includes("## Implemented M15 capability-curation safeguards")) {
    const block = `## Implemented M15 capability-curation safeguards

M15 treats distilled procedures, evaluation output, curation requests, pack metadata, and replay inputs as untrusted data unless a trusted runtime boundary validates them. Curation binds the exact M10 community-candidate hash and lifecycle, one domain, bounded task classes, context ceilings, and runtime-owned procedure keys. A trusted runtime clock—not caller-supplied time—controls evaluation freshness; future caller timestamps and stale-evidence rescue attempts fail closed.

Procedure novelty is not self-declared authority. Requested keys must belong to the canonical runtime procedure set or the runtime-owned additive catalog for the selected domain. Independent PASS evidence must cover every requested task class and preserve quality, safety, authority, token, and latency floors. M15 may verify the exact M10 candidate but never activate it.

Capability packs accept only integrity-valid passing M15 reports whose candidate/domain/task-class identity matches an exact M10 VERIFIED/ACTIVE community member and whose M10 verification history carries the same evidence references at the same evaluation time. Compact pack discovery omits instructions; full resolution remains behind M10 lifecycle checks. Offline replay receives no mutation interface and can only emit bounded recommendations.

The bounded live A/B runner keeps provider credentials in the control plane, caps calls, writes only sanitized evidence, and converts interrupted/failed arms into explicit failing measurements with conservative token accounting instead of allowing missing negative results to bias the comparison. Helper run \`33866236138\` verified these boundaries with 319/319 tests before checkpointing the hardened implementation.

`;
    if (!text.includes(anchor)) throw new Error("SECURITY prompt-injection marker missing");
    text = text.replace(anchor, block + anchor);
  }
  await writeFile(path, text, "utf8");
}

{
  const path = "HANDOVER.md";
  let text = await readFile(path, "utf8");
  const currentStart = text.indexOf("## Current state");
  const currentEnd = text.indexOf("## M14 capability", currentStart);
  if (currentStart < 0 || currentEnd < 0) throw new Error("HANDOVER current-state markers missing");
  const current = `## Current state

- Repository: \`clarityosbaerbelwesterop-gif/Odin-Agent-\` (private).
- \`main\` contains verified M0–M14 at merge commit \`48fc0074b6bd7df107b839ce0ce7bf1d877baa0c\`.
- Active work: PR #20 M15 **Curated Capability Pack + offline improvement evaluation** on \`agent/m15-curated-capability-pack\`.
- Hardened implementation checkpoint: \`075c46d301c53521cdb10e713d57d3f45386c244\`.
- Helper run \`33866236138\` passed **319/319 tests**, Biome, strict TypeScript, and secret-free Kimi dry smoke; aggregate coverage **89.81% lines / 77.03% branches / 95.85% functions**.
- Final M15 hardening binds evidence freshness to a trusted runtime clock, rejects self-declared procedure novelty outside the runtime-owned domain catalog, and records live A/B arm failures as explicit negative sanitized measurements.
- M15 curation/pack/replay infrastructure is implementation-verified, but no distilled candidate is ACTIVE and no domain pack is claimed populated without measured passing evidence.
- The user explicitly authorized merge after normal exact-head CI is green, then one bounded NVIDIA/Kimi K3 bare-model-vs-Odin A/B comparison. That comparison is task-specific evidence, not a public benchmark or AGI claim.
- M12 remains partially verified for hosted-sandbox/public-production claims. No production deployment, paid resource, migration, billing change, or public traffic is authorized by this work.

`;
  text = text.slice(0, currentStart) + current + text.slice(currentEnd);
  const planStart = text.indexOf("## M15 implementation plan");
  const standing = text.indexOf("## Standing boundaries", planStart);
  if (planStart < 0 || standing < 0) throw new Error("HANDOVER plan markers missing");
  const plan = `## M15 completion and post-merge evidence plan

1. Synchronize ROADMAP/ARCHITECTURE/SECURITY/M15 milestone/HANDOVER with helper-run evidence.
2. Obtain one normal exact-head \`npm run verify\` on the synchronized PR head; do not bypass \`action_required\` or any failed quality gate.
3. If green, mark PR #20 ready and merge under the user's explicit authorization.
4. From merged \`main\`, create a fresh benchmark-evidence branch and run one bounded NVIDIA \`moonshotai/kimi-k3\` baseline-vs-Odin coding A/B with sanitized evidence only.
5. Treat public Kimi K3 benchmark numbers and Odin's matched A/B as different evidence classes. Compare patterns and deltas, never splice Odin fixture percentages into vendor leaderboard scores.
6. If the candidate passes exact M15 gates, register only that exact measured candidate/report in a progressive pack; otherwise preserve the negative evidence and leave the pack absent.
7. Use the same matched A/B protocol for other provider/model identities later. Architectural reliability gains may transfer across models; measured lift magnitude must be re-established per model/profile/task class.

`;
  text = text.slice(0, planStart) + plan + text.slice(standing);
  await writeFile(path, text, "utf8");
}

{
  const path = "docs/milestones/M15_CURATED_CAPABILITY_PACK.md";
  let text = await readFile(path, "utf8");
  text = text.replace(
    "Status: **IMPLEMENTATION_IN_PROGRESS**. Updated: 2026-09-04.",
    "Status: **IMPLEMENTATION_VERIFIED_PENDING_FINAL_EXACT_HEAD_CI**. Updated: 2026-09-04.",
  );
  const anchor = "## Acceptance gate\n";
  if (!text.includes("## Implementation evidence")) {
    const evidence = `## Implementation evidence

Final hardening helper run \`33866236138\` passed 319/319 tests plus Biome, strict TypeScript, and the secret-free Kimi dry smoke before checkpointing commit \`075c46d301c53521cdb10e713d57d3f45386c244\`. Aggregate coverage was 89.81% lines / 77.03% branches / 95.85% functions; curator coverage was 95.48% / 81.05% / 97.22%, pack registry 90.43% / 77.88% / 95.24%, and replay 92.86% / 89.74% / 100%.

Review-found hardening now makes evaluation freshness depend on a trusted runtime clock, denies procedure keys outside the runtime-owned canonical/additive domain catalogs, binds pack membership to the same M15 evidence that established M10 verification, and records interrupted live A/B arms as conservative explicit failures rather than dropping negative evidence.

This verifies the M15 curation/pack/replay mechanism. It does **not** claim that any distilled candidate is already ACTIVE, that an unmeasured domain pack is populated, that Kimi K3 or another model gained a specific public-benchmark score, or that Odin is AGI/ASI. The first real provider lift measurement remains a separately bounded post-merge A/B step under the user's current authorization.

`;
    if (!text.includes(anchor)) throw new Error("M15 acceptance marker missing");
    text = text.replace(anchor, evidence + anchor);
  }
  await writeFile(path, text, "utf8");
}
