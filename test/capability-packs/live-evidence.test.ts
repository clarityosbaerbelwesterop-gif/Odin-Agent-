import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLiveFailure,
  isTerminalLiveMeasurementFailure,
  summarizeLiveComparisons,
} from "../../src/capability-packs/live-evidence.js";
import { BudgetExceededError, MissionDomainError } from "../../src/mission/runtime.js";
import { ProviderError } from "../../src/providers/errors.js";
import { CodingVerificationGateError } from "../../src/runtime/coding.js";

function arm(measurementComplete: boolean, qualityBps: number) {
  return { measurementComplete, qualityBps };
}

test("complete live pairs produce a measured summary", () => {
  const summary = summarizeLiveComparisons([
    { baseline: arm(true, 7000), candidate: arm(true, 9000) },
    { baseline: arm(true, 8000), candidate: arm(true, 8500) },
  ]);

  assert.deepEqual(summary, {
    averageLiftBps: 1250,
    baselineQualityBps: 7500,
    candidateQualityBps: 8750,
    cases: 2,
    completePairs: 2,
    incompletePairs: 0,
    status: "MEASURED",
    totalLiftBps: 2500,
  });
});

test("partial live evidence scores only complete matched pairs", () => {
  const summary = summarizeLiveComparisons([
    { baseline: arm(true, 8000), candidate: arm(true, 9000) },
    { baseline: arm(false, 0), candidate: arm(true, 9500) },
  ]);

  assert.deepEqual(summary, {
    averageLiftBps: 1000,
    baselineQualityBps: 8000,
    candidateQualityBps: 9000,
    cases: 2,
    completePairs: 1,
    incompletePairs: 1,
    status: "PARTIAL",
    totalLiftBps: 1000,
  });
});

test("zero complete pairs are inconclusive rather than a false zero-lift result", () => {
  const summary = summarizeLiveComparisons([
    { baseline: arm(false, 0), candidate: arm(false, 0) },
    { baseline: arm(false, 0), candidate: arm(false, 0) },
    { baseline: arm(false, 0), candidate: arm(false, 0) },
  ]);

  assert.deepEqual(summary, {
    averageLiftBps: null,
    baselineQualityBps: null,
    candidateQualityBps: null,
    cases: 3,
    completePairs: 0,
    incompletePairs: 3,
    status: "INCONCLUSIVE",
    totalLiftBps: null,
  });
});

test("live summary rejects empty malformed and out-of-range quality input", () => {
  assert.throws(
    () => summarizeLiveComparisons([{ baseline: arm(true, -1), candidate: arm(true, 5000) }]),
    TypeError,
  );
  assert.throws(
    () => summarizeLiveComparisons([{ baseline: arm(true, 5000), candidate: arm(true, 10_001) }]),
    TypeError,
  );
  assert.throws(
    () =>
      summarizeLiveComparisons([
        {
          baseline: { measurementComplete: "yes" as unknown as boolean, qualityBps: 5000 },
          candidate: arm(true, 5000),
        },
      ]),
    TypeError,
  );
  assert.throws(() => summarizeLiveComparisons([]), TypeError);
});

test("real provider and mission errors map to bounded diagnostics without raw messages", () => {
  const provider = new ProviderError({
    category: "rate_limit",
    message: "secret-bearing upstream text must not persist",
    provider: "fixture",
    retryable: true,
  });
  const mission = new MissionDomainError(
    "Model plan expectedSha does not match discovered repository state.",
  );
  const unknownMission = new MissionDomainError("opaque domain detail");

  assert.deepEqual(classifyLiveFailure(provider), {
    errorClass: "ProviderError",
    errorCode: "provider_rate_limit",
  });
  assert.deepEqual(classifyLiveFailure(mission), {
    errorClass: "MissionDomainError",
    errorCode: "plan_expected_sha_mismatch",
  });
  assert.deepEqual(classifyLiveFailure(unknownMission), {
    errorClass: "MissionDomainError",
    errorCode: "mission_domain_unknown",
  });
  assert.equal(JSON.stringify(classifyLiveFailure(provider)).includes("secret-bearing"), false);
});

test("budget verification and non-error failures have stable categories", () => {
  assert.deepEqual(classifyLiveFailure(new BudgetExceededError("inputTokens")), {
    errorClass: "BudgetExceededError",
    errorCode: "budget_inputTokens",
  });
  assert.deepEqual(classifyLiveFailure(new CodingVerificationGateError("private detail", null)), {
    errorClass: "CodingVerificationGateError",
    errorCode: "verification_gate_denied",
  });
  assert.deepEqual(classifyLiveFailure({ reason: "not an Error" }), {
    errorClass: "UnknownError",
    errorCode: "unknown_error",
  });
});

test("terminal model outcomes remain measurable while infrastructure interruptions stay incomplete", () => {
  const terminal = [
    classifyLiveFailure(
      new MissionDomainError("Model plan expectedSha does not match discovered repository state."),
    ),
    classifyLiveFailure(new MissionDomainError("Repair proposal does not change the target file.")),
    classifyLiveFailure(
      new MissionDomainError("Required quality gate is still failing after the bounded repair."),
    ),
    classifyLiveFailure(new CodingVerificationGateError("private detail", null)),
    classifyLiveFailure(new BudgetExceededError("outputTokens")),
    classifyLiveFailure(
      new ProviderError({
        category: "context_overflow",
        message: "opaque context detail",
        provider: "fixture",
        retryable: false,
      }),
    ),
  ];
  for (const diagnostic of terminal) {
    assert.equal(isTerminalLiveMeasurementFailure(diagnostic), true, diagnostic.errorCode);
  }

  const interruptedCategories = [
    "aborted",
    "authentication",
    "invalid_request",
    "malformed_response",
    "network",
    "permission",
    "quota",
    "rate_limit",
    "timeout",
    "unavailable",
    "unsupported",
    "unknown",
  ] as const;
  for (const category of interruptedCategories) {
    const diagnostic = classifyLiveFailure(
      new ProviderError({
        category,
        message: "opaque provider detail",
        provider: "fixture",
        retryable: true,
      }),
    );
    assert.equal(isTerminalLiveMeasurementFailure(diagnostic), false, diagnostic.errorCode);
  }

  assert.equal(
    isTerminalLiveMeasurementFailure(
      classifyLiveFailure(
        new MissionDomainError("Repository discovery found no bounded relevant source files."),
      ),
    ),
    false,
  );
  assert.equal(
    isTerminalLiveMeasurementFailure({ errorClass: "", errorCode: "quality_failed_after_repair" }),
    false,
  );
  assert.equal(
    isTerminalLiveMeasurementFailure({ errorClass: "MissionDomainError", errorCode: "" }),
    false,
  );
});

test("rerun-3 terminal diagnostics yield partial zero-lift evidence without upgrading ambiguity", () => {
  const terminal = (errorClass: string, errorCode: string) =>
    arm(isTerminalLiveMeasurementFailure({ errorClass, errorCode }), 0);
  const summary = summarizeLiveComparisons([
    {
      baseline: terminal("MissionDomainError", "quality_failed_after_repair"),
      candidate: terminal("ProviderError", "provider_malformed_response"),
    },
    {
      baseline: terminal("MissionDomainError", "quality_failed_after_repair"),
      candidate: terminal("MissionDomainError", "plan_expected_sha_mismatch"),
    },
    {
      baseline: terminal("MissionDomainError", "quality_failed_after_repair"),
      candidate: terminal("MissionDomainError", "repair_no_change"),
    },
  ]);

  assert.deepEqual(summary, {
    averageLiftBps: 0,
    baselineQualityBps: 0,
    candidateQualityBps: 0,
    cases: 3,
    completePairs: 2,
    incompletePairs: 1,
    status: "PARTIAL",
    totalLiftBps: 0,
  });
});

test("unknown categories and malformed error classes fail into bounded buckets", () => {
  const provider = new ProviderError({
    category: "unknown",
    message: "irrelevant",
    provider: "fixture",
    retryable: false,
  });
  Object.defineProperty(provider, "category", { value: "future_category" });
  const budget = new BudgetExceededError("attempts");
  Object.defineProperty(budget, "dimension", { value: "future_dimension" });
  const malformed = Object.assign(new Error("irrelevant"), {
    name: "bad class with spaces and control\n",
  });

  assert.deepEqual(classifyLiveFailure(provider), {
    errorClass: "ProviderError",
    errorCode: "provider_unknown",
  });
  assert.deepEqual(classifyLiveFailure(budget), {
    errorClass: "BudgetExceededError",
    errorCode: "budget_unknown",
  });
  assert.deepEqual(classifyLiveFailure(malformed), {
    errorClass: "Error",
    errorCode: "unclassified_error",
  });
});

test("run-4 grounded contract failures remain terminal measured evidence", () => {
  const messages = [
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

test("surgical grounded edit failures remain bounded terminal evidence", () => {
  const messages = [
    [
      "Grounded coding plan edit oldText was not found in trusted content.",
      "grounded_plan_edit_missing",
    ],
    [
      "Grounded coding plan edit oldText is ambiguous in trusted content.",
      "grounded_plan_edit_ambiguous",
    ],
    ["Grounded coding plan edit does not change trusted content.", "grounded_plan_edit_no_change"],
    [
      "Grounded coding repair edit oldText was not found in current content.",
      "grounded_repair_edit_missing",
    ],
    [
      "Grounded coding repair edit oldText is ambiguous in current content.",
      "grounded_repair_edit_ambiguous",
    ],
    [
      "Grounded coding repair edit does not change current content.",
      "grounded_repair_edit_no_change",
    ],
  ] as const;
  for (const [message, errorCode] of messages) {
    const diagnostic = classifyLiveFailure(new MissionDomainError(message));
    assert.deepEqual(diagnostic, { errorClass: "MissionDomainError", errorCode });
    assert.equal(isTerminalLiveMeasurementFailure(diagnostic), true, errorCode);
  }
});
