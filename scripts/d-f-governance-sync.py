from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, got {count}: {old[:100]!r}")
    file.write_text(text.replace(old, new, 1))


# Binding milestone contract.
replace_once(
    "docs/milestones/INTELLIGENCE_PHASE_D_F.md",
    "Status: **PHASE_VERIFIED — package hardening/governance pending**. This is the binding contract for one pull request containing exactly three sequential phases after the merged A–C intelligence tranche.",
    "Status: **PACKAGE_VERIFIED — final exact-head merge gate pending**. This is the binding contract for one pull request containing exactly three sequential phases after the merged A–C intelligence tranche.",
)
replace_once(
    "docs/milestones/INTELLIGENCE_PHASE_D_F.md",
    "Phase F helper run `34095778033` applied Biome formatting and then passed full `npm run verify` on the exact formatted working tree before committing `fd07443142c7313568e611e35196a7e55d878e8a`; the helper deleted itself. The automatic PR run created by the bot-authored formatting commit returned `action_required` with no jobs, so it is not counted as the final normal exact-head merge gate.",
    "Phase F helper run `34095778033` applied Biome formatting and passed full `npm run verify`; the fresh normal Phase F PR CI `34095946506` then passed on a user-authored checkpoint. Package-wide semantic hardening run `34097050800` subsequently passed **492/492 tests**, Biome, strict TypeScript, credential-free Kimi dry smoke, and aggregate coverage **90.02% lines / 76.67% branches / 96.05% functions**. That adversarial review also closed recomputed-hash semantic smuggling, D/E budget drift, capability/profile mismatch, and repair-policy mismatch before governance synchronization.",
)
replace_once(
    "docs/milestones/INTELLIGENCE_PHASE_D_F.md",
    "- [ ] package-wide adversarial review complete;\n- [ ] `ARCHITECTURE.md`, `SECURITY.md`, `ROADMAP.md`, and `HANDOVER.md` synchronized;\n- [ ] one fresh normal exact-head PR CI after governance synchronization;\n- [ ] merge only after the final exact-head CI is green and explicit merge authorization remains valid.",
    "- [x] package-wide adversarial review complete;\n- [x] `ARCHITECTURE.md`, `SECURITY.md`, `ROADMAP.md`, and `HANDOVER.md` synchronized;\n- [ ] one fresh normal exact-head PR CI after governance synchronization;\n- [ ] merge only after the final exact-head CI is green and explicit merge authorization remains valid.\n\nPackage adversarial evidence: run `34097050800`, **492/492 tests**, aggregate coverage **90.02% lines / 76.67% branches / 96.05% functions**. The final merge still requires a new normal CI on the exact governance head; this document does not pre-claim that result.",
)

# ROADMAP: replace the old pending D-F tail with the verified package state.
roadmap = Path("ROADMAP.md")
roadmap_text = roadmap.read_text()
marker = "### Next merge package — Phase D, E, F\n"
if roadmap_text.count(marker) != 1:
    raise SystemExit("ROADMAP.md: D-F marker mismatch")
prefix = roadmap_text.split(marker, 1)[0]
roadmap.write_text(prefix + '''### Merge package — Phase D, E, F\n\nStatus: **PACKAGE_VERIFIED — final exact-head merge gate pending** on PR #36.\n\nPhase D–F started from the merged A–C `main` head and remains provider-neutral.\n\n- [x] **Phase D — intelligence/reasoning amplification:** attributable Phase C weakness evidence maps to\n  bounded deterministic planning/decomposition/context/tool-grounding/critique/verification/repair\n  strategies without lowering M11/M21 quality floors or bypassing M5.\n- [x] **Phase E — weak-model amplification:** explicit capability/profile plus independent evaluation\n  evidence drives decomposition, context shaping, tool grounding, output discipline, and repair reserves;\n  model/provider names never imply capability or weakness.\n- [x] **Phase F — frontier amplification:** exact D/E hashes compose into an immutable\n  `evaluation_only` candidate and Benchmark 2.0/M22 matched evidence remains the only measurement\n  authority; analytics cannot promote or route by themselves.\n- [x] Package-wide adversarial hardening rejects recomputed-hash semantic smuggling, unknown D/E policy\n  values, capability/profile mismatch, D/E budget drift, repair-policy mismatch, tool/sandbox/secret\n  authority imports, and analytics-to-routing escalation.\n\nVerification evidence:\n\n- Phase D exact-head CI `34091888679`;\n- Phase E exact-head CI `34092487219`;\n- Phase F normal CI `34095946506`;\n- package hardening run `34097050800`: **492/492 tests**, aggregate coverage **90.02% lines / 76.67%\n  branches / 96.05% functions**, Biome, strict TypeScript, and credential-free Kimi dry smoke all pass.\n\nFinal D–F merge gates:\n\n- [x] focused Phase D/E/F tests and full verification;\n- [x] package-wide adversarial review;\n- [x] governance synchronization;\n- [ ] fresh normal exact-head PR CI on the final governance head;\n- [ ] merge PR #36 only after that CI is green and the PR remains mergeable.\n\nD–F itself performed no new live provider call, deployment, production migration, billing change, public\ntraffic, or new credential use. Any post-merge live evaluation is a separately authorized bounded\nmeasurement and cannot be relabeled as universal provider/model superiority or production readiness.\n''')

# ARCHITECTURE status and D-F package section.
replace_once(
    "ARCHITECTURE.md",
    "Status: M0–M28 are merged and repository-verified on `main`. The intelligence A–C tranche is\nimplemented and phase-verified on PR #35, pending the final governance-synchronized exact-head CI before\nmerge. M12/M26 remain **PARTIALLY_VERIFIED** for real hosted-sandbox/public-production proof; no\nrepository-local contract, synthetic fixture, benchmark report, or weakness analysis may be relabeled as\nlive infrastructure or live model-performance evidence.",
    "Status: M0–M28 and intelligence A–C are merged and repository-verified on `main`. Intelligence D–F\nis package-verified on PR #36 and awaits only the final governance-head CI plus merge. M12/M26 remain\n**PARTIALLY_VERIFIED** for real hosted-sandbox/public-production proof; no repository-local contract,\nsynthetic fixture, benchmark report, amplification candidate, or weakness analysis may be relabeled as\nlive infrastructure or live model-performance evidence.",
)
replace_once(
    "ARCHITECTURE.md",
    "21. Intelligence evaluation and weakness analysis are evidence/analytics only: Phase A profile envelopes,\n    Benchmark 2.0 reports, and Phase C heatmaps cannot mint M3/M5/M10/M11/M12/release authority.",
    "21. Intelligence evaluation and weakness analysis are evidence/analytics only: Phase A profile envelopes,\n    Benchmark 2.0 reports, and Phase C heatmaps cannot mint M3/M5/M10/M11/M12/release authority.\n22. D–F amplification policy objects remain bounded runtime/evaluation data. Hash validity never substitutes\n    for semantic validation, and D/E/F cannot create tools, credentials, routing quality, promotion,\n    completion, approval, sandbox, or release authority.",
)
arch = Path("ARCHITECTURE.md")
arch_text = arch.read_text()
arch_marker = "## Next intelligence package — Phase D–F\n"
if arch_text.count(arch_marker) != 1:
    raise SystemExit("ARCHITECTURE.md: D-F marker mismatch")
arch_prefix = arch_text.split(arch_marker, 1)[0]
arch.write_text(arch_prefix + '''## Intelligence package — Phase D–F (PR #36)\n\nD–F extends `src/routing` as a provider-neutral, bounded amplification/evaluation layer while preserving\nall earlier authorities:\n\n- **Phase D** consumes only hash-valid, profile/benchmark-bound attributable Phase C evidence and emits\n  bounded strategy recommendations. Unknown/infrastructure findings cannot masquerade as model reasoning\n  weakness and strategy ceilings cannot exceed the caller/runtime plan.\n- **Phase E** derives scaffolding only from explicit capability/profile declarations plus independent\n  quality evidence. It validates every D strategy semantically, binds context to the exact profile, and\n  cannot synthesize unsupported tool/structured-output capability or enlarge D budgets.\n- **Phase F** revalidates D/E semantics against Benchmark 2.0 and creates an immutable\n  `authority: evaluation_only`, `routingEligible: false`, `promotionEligible: false` candidate. It reports\n  quality, efficiency, verification, recovery, repair, and weakness deltas without hiding incomplete or\n  infrastructure evidence.\n\nPackage hardening run `34097050800` passed **492/492 tests** and explicitly guards against provider/model\nname heuristics, direct tool/sandbox/provider/secret/network authority, recomputed-hash semantic smuggling,\nbudget drift, and analytics-to-routing escalation. Aggregate coverage was **90.02% lines / 76.67%\nbranches / 96.05% functions**. These are repository verification facts, not live model benchmark claims.\n\nThe package performed no live provider spend. Separately authorized post-merge live runs remain evaluation\nevidence only until the existing M11/M21/M22/M5 authority and promotion requirements are satisfied.\n''')

# SECURITY top status and authority matrix.
replace_once(
    "SECURITY.md",
    "Status: deterministic safeguards through M28 are implemented and repository-verified on `main`.\nThe intelligence A–C tranche is phase-verified on PR #35 pending final governance-synchronized exact-head\nCI before merge. M12/M26 remain **PARTIALLY_VERIFIED** for real hosted-sandbox/public-production\nisolation. Controls not explicitly identified as implemented remain future work and must not be inferred\nfrom names, synthetic fixtures, benchmark reports, or weakness analytics.",
    "Status: deterministic safeguards through M28 and intelligence A–C are repository-verified on `main`.\nThe D–F amplification package is adversarially verified on PR #36 pending its final governance-head CI and\nmerge. M12/M26 remain **PARTIALLY_VERIFIED** for real hosted-sandbox/public-production isolation. Controls\nnot explicitly identified as implemented remain future work and must not be inferred from names,\nsynthetic fixtures, benchmark reports, amplification candidates, or weakness analytics.",
)
replace_once(
    "SECURITY.md",
    "- **Intelligence A–C** may bind evaluation profiles, run M22-compatible Benchmark 2.0 analysis, and mine\n  weaknesses; these remain analytics/evidence and cannot mint M3/M5/M10/M11/M12/release authority.",
    "- **Intelligence A–C** may bind evaluation profiles, run M22-compatible Benchmark 2.0 analysis, and mine\n  weaknesses; these remain analytics/evidence and cannot mint M3/M5/M10/M11/M12/release authority.\n- **Intelligence D–F** may derive bounded amplification/scaffolding policy and evaluation-only candidates\n  only after exact semantic/hash/profile/budget validation. D–F cannot mint tools, grants, credentials,\n  routing quality, promotion, completion, approvals, sandbox authority, or release evidence.",
)
security = Path("SECURITY.md")
security_text = security.read_text()
if "## Intelligence D–F amplification safeguards" not in security_text:
    security.write_text(security_text.rstrip() + '''\n\n## Intelligence D–F amplification safeguards\n\n- A SHA-256 match proves object integrity only; D/E/F validators separately enforce closed semantic enums,\n  exact benchmark/profile/domain binding, bounded numeric fields, uniqueness, and capability consistency.\n- Phase E must preserve the exact Phase D call/token ceilings and cannot exceed the profile context window.\n- Tool grounding and output discipline must match the bound capability profile; unsupported capability is\n  represented explicitly rather than synthesized.\n- Repair flags must agree with the exact D strategy set, and independent verification requirements cannot\n  be weakened by a caller-crafted E object.\n- Phase F remains `evaluation_only`/`analytics_only` with routing and promotion eligibility hard-false.\n- Static package tests deny direct provider/tool/sandbox/secret/network authority in the D–F policy layer\n  and deny provider/model-name heuristics.\n\nHardening run `34097050800` passed **492/492 tests**. Live runs authorized after merge are measurement\ninputs only and do not change these authority boundaries.\n''')

# HANDOVER: replace stale top summary while retaining historical detail, then append current checkpoint.
handover = Path("HANDOVER.md")
handover_text = handover.read_text()
handover_marker = "## M23 — Skill OS\n"
if handover_text.count(handover_marker) != 1:
    raise SystemExit("HANDOVER.md: historical marker mismatch")
_, historical = handover_text.split(handover_marker, 1)
current_header = '''# Engineering handover\n\nUpdated: 2026-09-07.\n\n## Current delivery state — intelligence D–F\n\nRepository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).\n\n- `main` contains the merged M0–M28 repository-local contracts plus intelligence A–C.\n- Active PR: **#36**, branch `agent/intelligence-d-e-f`, containing exactly Phase D, Phase E, and Phase F.\n- Binding contract: `docs/milestones/INTELLIGENCE_PHASE_D_F.md`.\n- Phase D CI `34091888679`, Phase E CI `34092487219`, and normal Phase F CI `34095946506` passed.\n- Package adversarial hardening run `34097050800` passed **492/492 tests**, Biome, strict TypeScript,\n  credential-free Kimi dry smoke, and aggregate **90.02% line / 76.67% branch / 96.05% function** coverage.\n- The review closed recomputed-hash semantic smuggling, unknown D/E policy values, exact D/E budget drift,\n  capability/profile mismatch, repair-policy mismatch, and analytics-to-routing escalation.\n- Governance synchronization is being committed now. One fresh normal CI on that exact governance head is\n  still mandatory before merge.\n- The user explicitly authorized merge of this three-phase block and exactly three bounded final live runs\n  after merge. Those live runs are evaluation evidence only, not routing/promotion/release authority.\n\nD–F itself uses no new provider/model, live provider call, deployment, paid infrastructure, production\nmigration, billing change, public traffic, or new credential. The separately authorized final runs may use\nthe already configured NVIDIA Kimi K3 secret under existing call/time/token ceilings.\n\n'''
handover.write_text(current_header + handover_marker + historical)

handover_text = handover.read_text()
if "## Intelligence D–F handover checkpoint — 2026-09-07" not in handover_text:
    handover.write_text(handover_text.rstrip() + '''\n\n## Intelligence D–F handover checkpoint — 2026-09-07\n\nPR #36 (`agent/intelligence-d-e-f`) contains exactly the second three-phase intelligence package.\n\n- Phase D: bounded weakness-driven reasoning amplification;\n- Phase E: explicit capability/evidence-driven weak-model scaffolding;\n- Phase F: immutable evaluation-only frontier amplification candidate over Benchmark 2.0/M22 semantics.\n\nRepository evidence before the final merge gate:\n\n- D `34091888679` PASS; E `34092487219` PASS; F `34095946506` PASS;\n- adversarial hardening `34097050800` PASS with **492/492 tests** and **90.02% / 76.67% / 96.05%**\n  aggregate line/branch/function coverage.\n\nFinal sequence: governance sync → one fresh normal exact-head CI → expected-head-pinned squash merge of PR\n#36 → exactly three separately authorized bounded live Kimi evaluations on the merged code. The live\nmeasurements must retain sanitized artifacts and may be described only as task/profile-specific evidence.\nThey do not establish universal model superiority, production deployment, AGI/ASI, or automatic routing\npromotion.\n''')
