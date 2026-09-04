import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

function replaceExact(content, anchor, replacement, label) {
  if (!content.includes(anchor)) throw new Error(`${label} anchor missing.`);
  return content.replace(anchor, replacement);
}

const evidencePath = "src/capability-packs/live-evidence.ts";
let evidence = readFileSync(evidencePath, "utf8");
evidence = replaceExact(
  evidence,
  '  ["Provider total token usage is inconsistent.", "provider_usage_inconsistent"],\n]);',
  `  ["Provider total token usage is inconsistent.", "provider_usage_inconsistent"],
  ["Grounded coding plan is not a JSON object.", "grounded_plan_structured_output_missing"],
  ["Grounded coding plan failed schema validation.", "grounded_plan_schema_invalid"],
  ["Grounded coding change is not an object.", "grounded_plan_change_invalid"],
  ["Grounded coding path is invalid.", "grounded_plan_path_invalid"],
  ["Grounded coding content is invalid.", "grounded_plan_content_invalid"],
  ["Grounded coding quality command is invalid.", "grounded_plan_quality_command_invalid"],
  [
    "Grounded coding provider selected a path outside trusted discovery.",
    "grounded_plan_target_outside_discovery",
  ],
  [
    "Grounded coding provider selected an unregistered quality command.",
    "grounded_plan_quality_command_unknown",
  ],
  ["Grounded coding repair is not a JSON object.", "grounded_repair_structured_output_missing"],
  ["Grounded coding repair failed schema validation.", "grounded_repair_schema_invalid"],
  ["Grounded coding repair content is invalid.", "grounded_repair_content_invalid"],
]);`,
  "live evidence map",
);
evidence = replaceExact(
  evidence,
  '  "budget_toolCalls",\n  "plan_dependencies_forbidden",',
  `  "budget_toolCalls",
  "grounded_plan_change_invalid",
  "grounded_plan_content_invalid",
  "grounded_plan_path_invalid",
  "grounded_plan_quality_command_invalid",
  "grounded_plan_quality_command_unknown",
  "grounded_plan_schema_invalid",
  "grounded_plan_structured_output_missing",
  "grounded_plan_target_outside_discovery",
  "grounded_repair_content_invalid",
  "grounded_repair_schema_invalid",
  "grounded_repair_structured_output_missing",
  "plan_dependencies_forbidden",`,
  "terminal diagnostics",
);
writeFileSync(evidencePath, evidence);

const groundedPath = "src/runtime/grounded-coding-provider.ts";
let grounded = readFileSync(groundedPath, "utf8");
grounded = replaceExact(
  grounded,
  "  validateToolInput(GROUNDED_CODING_PLAN_SCHEMA, output);",
  `  try {
    validateToolInput(GROUNDED_CODING_PLAN_SCHEMA, output);
  } catch {
    throw new MissionDomainError("Grounded coding plan failed schema validation.");
  }`,
  "grounded plan validation",
);
grounded = replaceExact(
  grounded,
  "  validateToolInput(GROUNDED_CODING_REPAIR_SCHEMA, output);",
  `  try {
    validateToolInput(GROUNDED_CODING_REPAIR_SCHEMA, output);
  } catch {
    throw new MissionDomainError("Grounded coding repair failed schema validation.");
  }`,
  "grounded repair validation",
);
writeFileSync(groundedPath, grounded);

const liveTestPath = "test/capability-packs/live-evidence.test.ts";
let liveTests = readFileSync(liveTestPath, "utf8");
if (!liveTests.includes("run-4 grounded contract failures remain terminal measured evidence")) {
  liveTests += `

test("run-4 grounded contract failures remain terminal measured evidence", () => {
  const messages = [
    ["Grounded coding plan is not a JSON object.", "grounded_plan_structured_output_missing"],
    ["Grounded coding plan failed schema validation.", "grounded_plan_schema_invalid"],
    ["Grounded coding change is not an object.", "grounded_plan_change_invalid"],
    ["Grounded coding path is invalid.", "grounded_plan_path_invalid"],
    ["Grounded coding content is invalid.", "grounded_plan_content_invalid"],
    ["Grounded coding quality command is invalid.", "grounded_plan_quality_command_invalid"],
    ["Grounded coding provider selected a path outside trusted discovery.", "grounded_plan_target_outside_discovery"],
    ["Grounded coding provider selected an unregistered quality command.", "grounded_plan_quality_command_unknown"],
    ["Grounded coding repair is not a JSON object.", "grounded_repair_structured_output_missing"],
    ["Grounded coding repair failed schema validation.", "grounded_repair_schema_invalid"],
    ["Grounded coding repair content is invalid.", "grounded_repair_content_invalid"],
  ] as const;

  for (const [message, errorCode] of messages) {
    const diagnostic = classifyLiveFailure(new MissionDomainError(message));
    assert.deepEqual(diagnostic, { errorClass: "MissionDomainError", errorCode });
    assert.equal(isTerminalLiveMeasurementFailure(diagnostic), true, errorCode);
  }

  const internalBindingFailure = classifyLiveFailure(
    new MissionDomainError("Grounded coding user payload is not valid JSON."),
  );
  assert.deepEqual(internalBindingFailure, {
    errorClass: "MissionDomainError",
    errorCode: "mission_domain_unknown",
  });
  assert.equal(isTerminalLiveMeasurementFailure(internalBindingFailure), false);
});
`;
}
writeFileSync(liveTestPath, liveTests);

const groundedTestPath = "test/runtime/grounded-coding-provider.test.ts";
let groundedTests = readFileSync(groundedTestPath, "utf8");
if (!groundedTests.includes("grounded provider normalizes model schema violations into a bounded contract failure")) {
  groundedTests += `

test("grounded provider normalizes model schema violations into a bounded contract failure", async () => {
  const inner = new ScriptedProvider([
    modelResponse({ change: { path: "src/user.ts" }, qualityCommandId: "verify" }, 10, 5),
  ]);
  const provider = new GroundedCodingProvider(inner);
  await assert.rejects(
    provider.generate(planRequest(discovery())),
    (error: unknown) => {
      assert.ok(error instanceof MissionDomainError);
      assert.equal(error.message, "Grounded coding plan failed schema validation.");
      return true;
    },
  );
});
`;
}
writeFileSync(groundedTestPath, groundedTests);

const evaluatorPath = "scripts/live-m16-grounded-eval.mjs";
let evaluator = readFileSync(evaluatorPath, "utf8");
evaluator = replaceExact(
  evaluator,
  `    inputTokens: 0,
    missingUsageCalls: 0,
    outputTokens: 0,
    successfulCalls: 0,
    totalTokens: 0,`,
  `    cachedInputTokens: 0,
    finishReasons: Object.create(null),
    inputTokens: 0,
    missingUsageCalls: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    successfulCalls: 0,
    totalTokens: 0,`,
  "usage meter state",
);
evaluator = replaceExact(
  evaluator,
  `  const addUsage = (usage) => {
    state.successfulCalls += 1;
    state.inputTokens += usage.inputTokens;
    state.outputTokens += usage.outputTokens;
    state.totalTokens += usage.totalTokens;
  };`,
  `  const addUsage = (usage, finishReason) => {
    state.successfulCalls += 1;
    state.cachedInputTokens += usage.cachedInputTokens ?? 0;
    state.inputTokens += usage.inputTokens;
    state.outputTokens += usage.outputTokens;
    state.reasoningOutputTokens += usage.reasoningOutputTokens ?? 0;
    state.totalTokens += usage.totalTokens;
    state.finishReasons[finishReason] = (state.finishReasons[finishReason] ?? 0) + 1;
  };`,
  "usage add",
);
evaluator = replaceExact(
  evaluator,
  "        addUsage(response.usage);",
  "        addUsage(response.usage, response.finishReason);",
  "generate finish reason",
);
evaluator = replaceExact(
  evaluator,
  "            addUsage(event.response.usage);",
  "            addUsage(event.response.usage, event.response.finishReason);",
  "stream finish reason",
);
evaluator = replaceExact(
  evaluator,
  "    usageSnapshot: () => ({ ...state }),",
  "    usageSnapshot: () => ({ ...state, finishReasons: { ...state.finishReasons } }),",
  "usage snapshot",
);
evaluator = replaceExact(
  evaluator,
  `  return {
    attemptedCalls: after.attemptedCalls - before.attemptedCalls,
    complete: after.missingUsageCalls === before.missingUsageCalls,
    inputTokens: after.inputTokens - before.inputTokens,
    missingUsageCalls: after.missingUsageCalls - before.missingUsageCalls,
    outputTokens: after.outputTokens - before.outputTokens,
    successfulCalls: after.successfulCalls - before.successfulCalls,
    totalTokens: after.totalTokens - before.totalTokens,
  };`,
  `  const finishReasons = {};
  for (const reason of new Set([...Object.keys(before.finishReasons), ...Object.keys(after.finishReasons)])) {
    const difference = (after.finishReasons[reason] ?? 0) - (before.finishReasons[reason] ?? 0);
    if (difference > 0) finishReasons[reason] = difference;
  }
  return {
    attemptedCalls: after.attemptedCalls - before.attemptedCalls,
    cachedInputTokens: after.cachedInputTokens - before.cachedInputTokens,
    complete: after.missingUsageCalls === before.missingUsageCalls,
    finishReasons,
    inputTokens: after.inputTokens - before.inputTokens,
    missingUsageCalls: after.missingUsageCalls - before.missingUsageCalls,
    outputTokens: after.outputTokens - before.outputTokens,
    reasoningOutputTokens: after.reasoningOutputTokens - before.reasoningOutputTokens,
    successfulCalls: after.successfulCalls - before.successfulCalls,
    totalTokens: after.totalTokens - before.totalTokens,
  };`,
  "usage delta",
);
evaluator = replaceExact(
  evaluator,
  `      firstPass: result.report.quality.firstFailureSignature === null,
      latencyMs,
      measurementComplete: true,
      mutationObserved: finalContent !== initialContent,`,
  `      acceptedFinalContent: caseSpec.accepts(finalContent),
      exactFinalContent: finalContent === caseSpec.expected,
      firstPass: result.report.quality.firstFailureSignature === null,
      latencyMs,
      measurementComplete: true,
      mutationObserved: finalContent !== initialContent,`,
  "success acceptance telemetry",
);
evaluator = replaceExact(
  evaluator,
  `      finalContent,
      firstPass: false,
      latencyMs,
      measurementComplete: isTerminalLiveMeasurementFailure(diagnostic),`,
  `      finalContent,
      acceptedFinalContent: caseSpec.accepts(finalContent),
      exactFinalContent: finalContent === caseSpec.expected,
      firstPass: false,
      latencyMs,
      measurementComplete: isTerminalLiveMeasurementFailure(diagnostic),`,
  "failure acceptance telemetry",
);
evaluator = replaceExact(
  evaluator,
  `    changedFiles: run.changedFiles,
    completed: run.completed,`,
  `    acceptedFinalContent: run.acceptedFinalContent,
    changedFiles: run.changedFiles,
    completed: run.completed,`,
  "sanitized acceptance telemetry",
);
evaluator = replaceExact(
  evaluator,
  `    errorClass: run.errorClass,
    errorCode: run.errorCode,
    finalContentHash:`,
  `    errorClass: run.errorClass,
    errorCode: run.errorCode,
    exactFinalContent: run.exactFinalContent,
    finalContentHash:`,
  "sanitized exact telemetry",
);
writeFileSync(evaluatorPath, evaluator);

const analysisPath = "docs/evals/M16_KIMI_GROUNDED_OUTPUT_RUN_4_ANALYSIS.md";
writeFileSync(
  analysisPath,
  `# M16 Kimi K3 grounded output run 4 analysis

Updated: 2026-09-04.

## Scope

Run \`33896223881\` is the fourth explicitly authorized NVIDIA \`moonshotai/kimi-k3\` live evaluation. It compares the legacy M4 coding contract with the same model/runtime wrapped by \`GroundedCodingProvider\`. Repository verification, build, and credential-free dry-run passed before provider access. The run consumed 11/12 maximum provider calls and preserved sanitized evidence at \`docs/evals/m16-kimi-grounded-output-run-4.json\`.

## Measured result

The historical run-4 artifact is **PARTIAL**: two of three matched pairs were complete under the classifier that existed during the run. On those two complete pairs, both paths remained at quality 0, so no completion or quality uplift is proven. The grounded path did, however, use **2,196** total tokens versus **3,916** for legacy, a measured **43.92% token reduction**, and **174,981 ms** versus **277,968 ms** aggregate latency, a measured **37.05% latency reduction**. Provider-call count worsened from 3 to 4 on that matched subset.

These reductions are task- and profile-specific. They are not model-wide benchmarks and do not transfer numerically to GPT-6 Astra, Claude Fable 5.1, GLM, or another provider/profile.

## Run-4 defect found before run 5

The incomplete \`canonical-user-id\` grounded arm made two successful metered provider calls, mutated the target, and then ended as \`MissionDomainError / mission_domain_unknown\`. Review found that M16 introduced new deterministic grounded-contract errors but the live-evidence classifier still knew only legacy M4 error messages. A grounded schema/content/path/quality-command failure could therefore become \`mission_domain_unknown\` and disappear from matched scoring even though the provider calls completed.

The hardening tranche adds bounded codes for model-output-side grounded plan/repair contract failures and treats those codes as terminal measured outcomes. Runtime request-binding failures remain unknown/incomplete instead of being mislabeled as model quality. Grounded schema-validation failures are normalized into bounded MissionDomain errors rather than leaking validator detail.

The strength evaluator is also extended with secret-safe telemetry: normalized finish-reason counts, cached/reasoning token subtotals where the provider supplies them, and boolean deterministic acceptance/exact-output signals. Raw model text and repository content remain absent from evidence.

## Claim boundary

Run 4 proves a substantial token/latency efficiency signal on two matched failing cases, not a quality win. No Odin-vs-Astra/Fable intelligence-superiority claim follows. Run 5 must execute only after this diagnostic hardening passes normal CI and is merged.
`,
);

const handoverMarker = "## M16 run-4 grounded output evidence — 2026-09-04";
const handover = readFileSync("HANDOVER.md", "utf8");
if (!handover.includes(handoverMarker)) {
  appendFileSync(
    "HANDOVER.md",
    `

${handoverMarker}

Authorized NVIDIA/Kimi K3 run \`33896223881\` completed after verify/build/dry-run gates and used 11/12 live calls. Immutable evidence is \`docs/evals/m16-kimi-grounded-output-run-4.json\`; interpretation is \`docs/evals/M16_KIMI_GROUNDED_OUTPUT_RUN_4_ANALYSIS.md\`. Historical result: **PARTIAL**, 2/3 complete pairs. On those matched pairs, grounded M4 reduced total tokens from 3,916 to 2,196 (**43.92%**) and aggregate latency from 277,968 ms to 174,981 ms (**37.05%**), while provider calls increased from 3 to 4 and quality stayed 0 vs 0. No completion/quality superiority is established.

Review found a deterministic evidence-classification gap: new grounded plan/repair contract failures could collapse to \`mission_domain_unknown\`, making a completed model-contract failure look measurement-incomplete. M16 now assigns bounded terminal codes to model-output-side grounded failures, normalizes grounded schema-validation failure, and adds safe finish-reason/token/acceptance telemetry for the fifth strength run. Runtime binding failures stay incomplete. Run 5 remains authorized but must occur only after this hardening is normal-CI green and merged.
`,
  );
}
