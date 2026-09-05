import { readFile, writeFile } from "node:fs/promises";

function replaceExact(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing M20-M22 docs anchor: ${label}`);
  return text.replace(from, to);
}

const milestonePath = "docs/milestones/M20_M22_AUTONOMY_ROUTING_FRONTIER_EVALS.md";
let milestone = await readFile(milestonePath, "utf8");
milestone = milestone.replace(
  "Status: **IN PROGRESS**.",
  "Status: **VERIFIED_AWAITING_FINAL_EXACT_HEAD_CI**.",
);
milestone = milestone.replaceAll("- [ ]", "- [x]");
milestone = milestone.replace(
  "Goal: establish a reproducible benchmark protocol for model-alone versus model-plus-Odin and comparable external-agent baselines without turning benchmark output into runtime authority.",
  "Goal: establish a reproducible benchmark protocol for model-alone versus model-plus-Odin without turning benchmark output into runtime authority. External-agent comparison requires a separately verified adapter/provenance contract and is not claimed by M22 v1.",
);
milestone = replaceExact(
  milestone,
  "## Verification and delivery\n",
  `## Verified implementation evidence

Final adversarial hardening run \`33951098718\` passed **408/408 tests**, Biome, strict TypeScript,
credential-free Kimi dry smoke, and \`npm run build\`. Aggregate coverage was **90.29% lines / 77.60%
branches / 96.09% functions**. Focused coverage was **86.16% / 74.31% / 100%** for the M20 soak
engine, **88.36% / 76.27% / 100%** for M21 failure-aware routing, and **91.48% / 78.76% / 100%**
for the M22 frontier-evaluation suite.

M20's 6 h, 12 h, and 24 h results are logical-duration synthetic-clock proofs, not wall-clock uptime
claims. The runtime rejects unknown or misplaced soak-event fields before hashing and again on replay;
restart evidence binds the latest checkpoint, lease generations fence stale settlement, cancellation
beats late success, and equivalent failure signatures are bounded.

M21's five-provider matrix is an **offline identity/evidence fixture**. It proves that recent typed
failures can only remove exact routes before the existing M11 quality/capability/budget router runs;
negative failure evidence cannot lower a quality floor, add budget, or create positive evaluation
quality. No provider name implies a capability and no live provider was called.

M22's 60-case held-out fixture validates the protocol and aggregation semantics with synthetic outcomes;
it is **not** a real frontier-model benchmark result. Hidden acceptance metadata is omitted from the
model-facing projection, matched arms require the same provider/model/profile/reasoning/harness/budget,
per-case ceilings are enforced, two results for one arm cannot be cherry-picked, deterministic terminal
task failures remain measurable negatives, and infrastructure-ambiguous pairs remain unscored. Zero
complete pairs is INCONCLUSIVE rather than numeric zero lift. External-agent baselines are not
implemented or claimed in this v1 package.

## Verification and delivery
`,
  "verified evidence insertion",
);
await writeFile(milestonePath, milestone, "utf8");

const roadmapPath = "ROADMAP.md";
let roadmap = await readFile(roadmapPath, "utf8");
roadmap = replaceExact(
  roadmap,
  `## M20 — Long-running autonomy

- [ ] Six-, twelve-, and twenty-four-hour soak profiles with bounded budgets and synthetic clocks where
  appropriate.
- [ ] Durable checkpoints, crash/lease recovery, cancellation, reconnect, and anti-loop enforcement.
- [ ] No duration claim without preserved recovery and integrity evidence.

## M21 — Multi-model router

- [ ] Empirical task-specific profiles across configured Kimi, OpenAI, Anthropic, GLM, and OpenRouter
  routes without assuming capabilities from model names.
- [ ] Quality-floor, latency, cost, availability, and previous-failure-aware selection and escalation.
- [ ] Every numeric comparison remains bound to provider, model, profile, task class, and evidence version.

## M22 — Frontier evaluation suite

- [ ] Reproducible 50–200 task suite covering coding, reasoning, tool use, recovery, and long missions.
- [ ] Hidden/held-out fixtures and equal tool/budget conditions for model-alone versus model-plus-Odin.
- [ ] Comparable external agent baselines only where their public interfaces and conditions are verifiable.
`,
  `## M20 — Long-running autonomy

- [x] Versioned six-, twelve-, and twenty-four-hour logical soak profiles with runtime-owned synthetic
  clocks, hash-chained events, explicit checkpoint/restart/recovery/failure/budget ceilings, and
  deterministic reports.
- [x] Restart checkpoint binding, higher-generation lease recovery, stale-settlement fencing,
  cancellation-terminal behavior, event-shape validation, and equivalent-failure anti-loop enforcement.
- [x] Duration claims remain explicitly scoped to logical synthetic-clock coverage; no wall-clock or
  hosted-runtime uptime claim is made.

## M21 — Multi-model router

- [x] Empirical exact provider/model/profile/reasoning/task-class routing is exercised across offline
  NVIDIA/Kimi, OpenAI, Anthropic, GLM, and OpenRouter-style identities without name-based capability
  assumptions.
- [x] Fresh M11 quality/capability floors remain upstream of cost/latency optimization; bounded recent
  typed failures may exclude only the exact failed route and cannot lower quality or raise budget.
- [x] Failure/evaluation/profile identities are hash/freshness bound; malformed, future, stale, tampered,
  all-excluded, and input-container failure cases are deterministic and fail closed.

## M22 — Frontier evaluation suite

- [x] Versioned 50–200 case protocol spans coding, reasoning, tool use, recovery, and long-mission task
  classes; the verified fixture uses 60 held-out synthetic cases.
- [x] Hidden acceptance metadata is omitted from model-facing projections and matched model-alone/Odin
  arms require equal provider/model/profile/reasoning/harness/budget identity with per-case ceilings.
- [x] COMPLETE/PARTIAL/INCONCLUSIVE aggregation excludes infrastructure ambiguity, preserves deterministic
  task failures as negative evidence, blocks cherry-picking/duplicate arms, and creates no M5/M11
  authority. External-agent baselines are not implemented or claimed by v1.

Final adversarial hardening run \`33951098718\` passed **408/408 tests**, Biome, strict TypeScript,
credential-free Kimi dry smoke, and build; aggregate coverage was **90.29% / 77.60% / 96.09%**.
Normal exact-head PR CI remains required before merge.
`,
  "roadmap M20-M22 block",
);
await writeFile(roadmapPath, roadmap, "utf8");

const handoverPath = "HANDOVER.md";
let handover = await readFile(handoverPath, "utf8");
const oldStart = handover.indexOf("## Current state — M17–M19 package");
const oldEnd = handover.indexOf("\n## Current state\n", oldStart);
if (oldStart < 0 || oldEnd < 0) throw new Error("Missing M17-M19 handover current-state block");
const newState = `## Current state — M20–M22 package

- PR #31 (M17–M19) was squash-merged into \`main\` as
  \`090bfe3d68edd7b6cb0de0bad5e77bade7e14915\` after normal exact-head CI passed.
- Active PR: **#32**, branch \`agent/m20-m22-autonomy-router-frontier-evals\`, containing exactly M20,
  M21, and M22.
- M20 adds versioned 6 h / 12 h / 24 h logical soak profiles with synthetic-clock integrity,
  checkpoint/restart binding, generation fencing, cancellation terminality, retry anti-looping, exact
  event shapes, and deterministic reports. These are logical-duration proofs, not real wall-clock uptime.
- M21 adds a bounded failure-aware layer over M11. Fresh typed failures may exclude only the exact
  provider/model/profile/reasoning/task-class route; M11 still owns capability, quality-floor, cost,
  latency, and escalation decisions. The five-provider matrix is offline fixture evidence only.
- M22 adds a versioned matched-evaluation protocol for 50–200 cases. Hidden acceptance metadata is not
  model-facing; arm identity and per-case budgets must match; deterministic task failures remain negative
  evidence while infrastructure ambiguity remains incomplete. The verified 60-case fixture uses synthetic
  outcomes and is not a live frontier benchmark.
- Final adversarial hardening run \`33951098718\` passed **408/408 tests**, Biome, strict TypeScript,
  credential-free Kimi dry smoke, and build. Aggregate coverage: **90.29% lines / 77.60% branches /
  96.09% functions**.
- No live provider call, deployment, paid resource, migration, billing change, or public traffic was used
  for M20–M22.
- Remaining gate: synchronized governance verification followed by normal exact-head PR CI. Merge remains
  separately approval-gated.

`;
handover = `${handover.slice(0, oldStart)}${newState}${handover.slice(oldEnd + 1)}`;
handover = handover.replace("## Current state\n\n- Repository:", "## Historical M15 state\n\n- Repository:");
await writeFile(handoverPath, handover, "utf8");

const architecturePath = "ARCHITECTURE.md";
let architecture = await readFile(architecturePath, "utf8");
architecture = architecture.replace(
  "Status: M0–M15 are merged and verified on `main`.",
  "Status: M0–M19 are merged and verified on `main`; M20–M22 are implemented on active PR #32 and await final exact-head CI before any merge claim.",
);
architecture += `

## M20–M22 architecture extension — active PR #32

### M20 — Long-running autonomy evidence

\`src/autonomy\` is an integrity/evaluation layer over the existing M2/M8 durable runtime, not a second
mission store. Runtime-owned versioned soak profiles define logical 6 h / 12 h / 24 h coverage and
resource ceilings. Hash-chained exact-shape observations represent checkpoints, restarts, lease recovery,
settlement, cancellation, bounded failures, budget consumption, and heartbeats. Replay rejects unknown
fields, clock regression, foreign restart checkpoints, stale generations, late success after cancellation,
and equivalent-failure loops. Existing M8 SQLite events/checkpoints/jobs remain canonical; synthetic
soak time does not establish hosted wall-clock uptime.

### M21 — Failure-aware multi-model routing

\`src/routing/multi-model.ts\` adds a negative-evidence filter in front of the existing M11 empirical
router. A recent typed failure is bound to exact provider/model/profile/reasoning/task-class identity and
failure signature. It may exclude that exact route after runtime-owned rules, but it cannot create positive
quality evidence, lower the M11 floor, add capability, or raise call/token/cost budget. The surviving set
still passes through the existing M11 capability, freshness, independent-quality, cost, latency, and
escalation logic. The configured provider names in tests are offline identities, not live capability proof.

### M22 — Frontier evaluation protocol

\`src/frontier-evals\` is a non-authoritative evidence protocol. Cases commit to public input, hidden
acceptance metadata, task class, suite version, and an exact budget profile. Model-facing projections omit
the hidden acceptance hash itself. Results bind arm, exact model profile/reasoning, harness, budget,
completion attribution, verification, failure class, quality, tokens, latency, calls, tools, repairs, and
recoveries. Numeric aggregates use only complete attributable matched pairs; infrastructure ambiguity is
never coerced into zero. COMPLETE/PARTIAL/INCONCLUSIVE reports are benchmark evidence only and cannot
become M5 completion or M11 quality evidence without a separate independent promotion path. M22 v1
implements the model-alone/Odin protocol with synthetic offline fixtures; no real frontier-model or
external-agent benchmark is claimed.
`;
await writeFile(architecturePath, architecture, "utf8");

const securityPath = "SECURITY.md";
let security = await readFile(securityPath, "utf8");
security += `

## M20–M22 autonomy, routing, and evaluation safeguards — active PR #32

M20 soak observations are runtime data, not model-authored authority. The producer and replay paths both
require the exact event-specific field set; unknown, missing, or misplaced fields fail closed. Every replay
enforces a contiguous SHA-256 chain and monotonic synthetic time. Restarts must name the latest trusted
checkpoint, recovered leases must strictly increase generation, stale settlement cannot win, cancellation
blocks late success, repeated equivalent failure signatures are bounded, and profile/event/restart/
recovery/budget ceilings are runtime-owned. M8 durable state remains canonical. Synthetic logical duration
is not evidence of production uptime.

M21 recent route failures are negative routing evidence only. They are exact provider/model/profile/
reasoning/task-class/signature records with bounded age and hash integrity. Stale entries are ignored;
future/tampered/malformed entries fail. The layer can remove an exact recently failing route but cannot
invent positive evaluation quality, lower M11 quality floors, grant capability, increase budget, resolve
credentials, or choose a stronger sandbox scope. The remaining candidates still pass normal M11 checks.

M22 treats benchmark cases and results as untrusted evidence objects. Hidden acceptance metadata is
excluded from the model-facing projection; result identity is bound to suite/case/arm/model/profile/
reasoning/harness/budget and bounded execution metrics. Matched arms must have equal identity and budget,
results beyond per-case ceilings fail, and multiple results for one arm cannot be cherry-picked. Only
complete attributable outcomes are scored. Deterministic terminal task failures remain complete negative
evidence, while timeout/network/auth/rate-limit/unavailable/malformed/unknown infrastructure ambiguity is
INCOMPLETE and excluded from numeric lift. A zero-complete-pair report is INCONCLUSIVE with null numeric
lift. These reports cannot mint M3/M5/M10/M11/M12/release authority, and this package performs no live
provider or external-agent benchmark.
`;
await writeFile(securityPath, security, "utf8");
