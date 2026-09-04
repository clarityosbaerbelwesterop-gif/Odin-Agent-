import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, before, after, label) {
  const text = await readFile(path, "utf8");
  const matches = text.split(before).length - 1;
  if (matches !== 1) throw new Error(`${label}: expected exactly one match, found ${matches}.`);
  await writeFile(path, text.replace(before, after), "utf8");
}

await replaceOnce(
  "ROADMAP.md",
  "- [ ] Record the first real post-merge bare-model-vs-Odin provider A/B evidence and populate a measured pack only if the candidate passes the same quality/safety/authority gates.",
  "- [x] Attempt the first bounded post-merge Kimi K3 baseline-vs-candidate provider A/B and preserve its sanitized evidence; run `33870210502` used 10/12 provider calls but produced zero complete matched pairs, so the result is INCONCLUSIVE.\n- [ ] Obtain complete matched provider evidence before populating any measured coding pack; only an exact candidate that passes the normal quality/safety/authority/token/latency gates may enter the pack.",
  "M15 post-merge A/B roadmap state",
);

await replaceOnce(
  "ROADMAP.md",
  "Implementation verification helper run `33866236138` passed **319/319 tests**, Biome, strict TypeScript, and secret-free Kimi dry smoke after the final curation/A-B hardening. Aggregate coverage was **89.81% lines / 77.03% branches / 95.85% functions**. `capability-packs/curator` reached **95.48% / 81.05% / 97.22%**, registry **90.43% / 77.88% / 95.24%**, and replay **92.86% / 89.74% / 100%**. A normal synchronized exact-head PR CI remains required before merge. No distilled candidate is ACTIVE and no broad model-quality claim is made from contract tests.",
  "Implementation verification helper run `33866236138` passed **319/319 tests**, Biome, strict TypeScript, and secret-free Kimi dry smoke after the final curation/A-B hardening. Aggregate coverage was **89.81% lines / 77.03% branches / 95.85% functions**. `capability-packs/curator` reached **95.48% / 81.05% / 97.22%**, registry **90.43% / 77.88% / 95.24%**, and replay **92.86% / 89.74% / 100%**. Normal exact-head PR CI `33870080147` passed and PR #20 was merged into `main` as `30bcab22f6129925b704fff0d024ca40e472b06c`. The post-merge run does not verify a coding winner: all six arms were incomplete, no distilled candidate is ACTIVE, and no broad model-quality claim is made.",
  "M15 verification roadmap evidence",
);

await replaceOnce(
  "ARCHITECTURE.md",
  "Status: M0–M13 are merged and verified; M14 skill-intake implementation is verified in normal PR CI and this synchronized head is awaiting its final exact-head CI before merge. M12 remains partially verified for hosted-sandbox/public-production proof, 2026-09-04.",
  "Status: M0–M15 are merged and verified on `main`. M12 remains partially verified for hosted-sandbox/public-production proof. The first post-merge Kimi K3 M15 comparison attempt is preserved as INCONCLUSIVE because no matched arm pair completed, 2026-09-04.",
  "architecture status",
);

await replaceOnce(
  "ARCHITECTURE.md",
  "Implementation verification helper run `33866236138` passed 319/319 tests with 89.81% line / 77.03% branch / 95.85% function coverage after trusted-clock, procedure-catalog, and A/B failure-evidence hardening. Final normal exact-head CI is still required before merge.",
  "Implementation verification helper run `33866236138` passed 319/319 tests with 89.81% line / 77.03% branch / 95.85% function coverage after trusted-clock, procedure-catalog, and A/B failure-evidence hardening. Normal exact-head PR CI `33870080147` passed before M15 merged into `main` as `30bcab22f6129925b704fff0d024ca40e472b06c`.\n\nAuthorized post-merge run `33870210502` attempted three matched NVIDIA Kimi K3 coding cases with ten provider calls. Every baseline and candidate arm was incomplete, leaving zero complete matched pairs. The raw sanitized evidence is therefore INCONCLUSIVE and cannot establish candidate lift, pack eligibility, model superiority, or AGI-level capability. Post-run evidence semantics treat zero complete pairs as INCONCLUSIVE rather than numeric zero lift and expose only bounded non-secret failure categories.",
  "architecture M15 evidence",
);

await replaceOnce(
  "ARCHITECTURE.md",
  "Local CI may never manufacture `integration` or `live` evidence. Any paid resource, deployment, or\nproduction/public traffic remains separately approval-gated. M15's curation, progressive-pack, and proposal-only replay boundaries are implementation-verified and awaiting normal exact-head CI before merge. After merge, one user-authorized bounded Kimi K3 bare-model-vs-Odin A/B may record task-specific lift; only a passing exact-hash result may become measured M10 verification/pack evidence. Broader provider or public-benchmark claims require their own matched evaluations.",
  "Local CI may never manufacture `integration` or `live` evidence. Any paid resource, deployment, or\nproduction/public traffic remains separately approval-gated. M15's curation, progressive-pack, and proposal-only replay boundaries are merged and verified. The first authorized post-merge Kimi K3 comparison attempt is preserved as INCONCLUSIVE because no matched arm pair completed; it creates no M10 verification or pack evidence. Another live provider run requires separate user authorization, and broader provider or public-benchmark claims require their own complete matched evaluations.",
  "architecture next milestone evidence",
);

await replaceOnce(
  "SECURITY.md",
  "The bounded live A/B runner keeps provider credentials in the control plane, caps calls, writes only sanitized evidence, and converts interrupted/failed arms into explicit failing measurements with conservative token accounting instead of allowing missing negative results to bias the comparison. Helper run `33866236138` verified these boundaries with 319/319 tests before checkpointing the hardened implementation.",
  "The bounded live A/B runner keeps provider credentials in the control plane, caps calls, and writes only sanitized evidence. Helper run `33866236138` verified the pre-merge boundaries with 319/319 tests. Authorized post-merge run `33870210502` then exposed an evidence-interpretation edge case: all six arms were incomplete, so the historical numeric zero summary could be mistaken for measured zero lift even though no matched pair completed. The raw evidence remains fail-closed and unpromoted; post-run hardening classifies zero complete pairs as `INCONCLUSIVE` with null quality/lift and records only bounded failure categories rather than raw exception text. A further live provider request remains separately approval-gated.",
  "security M15 live evidence",
);
