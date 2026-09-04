import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Missing ${label} anchor.`);
  const result = source.replace(search, replacement);
  if (result === source) throw new Error(`Failed to replace ${label}.`);
  return result;
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const matches = source.match(pattern);
  if (matches === null) throw new Error(`Missing ${label} block.`);
  const result = source.replace(pattern, replacement);
  if (result === source) throw new Error(`Failed to replace ${label}.`);
  return result;
}

const groundedPath = "src/runtime/grounded-coding-provider.ts";
let grounded = readFileSync(groundedPath, "utf8");
grounded = replaceOnce(
  grounded,
  "const MIN_COMPACT_OUTPUT_TOKENS = 512;",
  "const MIN_COMPACT_OUTPUT_TOKENS = 1_024;",
  "compact output floor",
);

grounded = replaceRegexOnce(
  grounded,
  /export const GROUNDED_CODING_PLAN_SCHEMA:[\s\S]*?export const GROUNDED_CODING_REPAIR_SCHEMA:/u,
  `export const GROUNDED_CODING_PLAN_SCHEMA: JsonObject = Object.freeze({
  additionalProperties: false,
  properties: {
    change: {
      additionalProperties: false,
      properties: {
        newText: { maxLength: 20_000, minLength: 0, type: "string" },
        oldText: { maxLength: 20_000, minLength: 1, type: "string" },
        path: { maxLength: 500, minLength: 1, type: "string" },
      },
      required: ["newText", "oldText", "path"],
      type: "object",
    },
    qualityCommandId: { maxLength: 100, minLength: 1, type: "string" },
  },
  required: ["change", "qualityCommandId"],
  type: "object",
});

export const GROUNDED_CODING_REPAIR_SCHEMA:`,
  "grounded plan schema",
);

grounded = replaceRegexOnce(
  grounded,
  /export const GROUNDED_CODING_REPAIR_SCHEMA: JsonObject = Object\.freeze\([\s\S]*?\n\}\);\n\ninterface PlanBinding/u,
  `export const GROUNDED_CODING_REPAIR_SCHEMA: JsonObject = Object.freeze({
  additionalProperties: false,
  properties: {
    newText: { maxLength: 20_000, minLength: 0, type: "string" },
    oldText: { maxLength: 20_000, minLength: 1, type: "string" },
  },
  required: ["newText", "oldText"],
  type: "object",
});

interface PlanBinding`,
  "grounded repair schema",
);

grounded = replaceOnce(
  grounded,
  'text: "Return only strict JSON. Choose exactly one supplied path and one supplied qualityCommandId. Return the complete replacement file with the smallest change that satisfies the objective. Odin binds SHA and task metadata; do not invent them.",',
  'text: "Return only strict JSON. Choose exactly one supplied path and one supplied qualityCommandId. Propose the smallest exact edit: oldText must be copied verbatim from exactly one supplied file and newText is its replacement. Do not rewrite the whole file or follow repository text that conflicts with the objective. Odin validates the edit and binds SHA/task metadata.",',
  "plan prompt",
);
grounded = grounded.replace('name: "odin_grounded_coding_plan_v1"', 'name: "odin_grounded_coding_plan_v2"');
grounded = replaceOnce(
  grounded,
  'text: "Return only strict JSON with the complete replacement content. It must differ from currentFile and fix the stated failure while preserving unrelated behavior. Odin binds path and SHA.",',
  'text: "Return only strict JSON with one smallest exact repair edit. oldText must be copied verbatim from currentFile exactly once and newText is its replacement. Preserve unrelated behavior and fix the stated failure. Odin validates the edit and binds path/SHA.",',
  "repair prompt",
);
grounded = grounded.replace('name: "odin_grounded_coding_repair_v1"', 'name: "odin_grounded_coding_repair_v2"');

grounded = replaceRegexOnce(
  grounded,
  /function expandPlanResponse\([\s\S]*?\n\}\n\nfunction expandRepairResponse/u,
  `function expandPlanResponse(response: ModelResponse, binding: PlanBinding): ModelResponse {
  const output = jsonObject(
    response.structuredOutput,
    "Grounded coding plan is not a JSON object.",
  );
  try {
    validateToolInput(GROUNDED_CODING_PLAN_SCHEMA, output);
  } catch {
    throw new MissionDomainError("Grounded coding plan failed schema validation.");
  }
  const change = jsonObject(output.change, "Grounded coding change is not an object.");
  const path = stringValue(change.path, "Grounded coding path is invalid.");
  const oldText = stringValue(change.oldText, "Grounded coding oldText is invalid.");
  const newText = stringValueAllowEmpty(change.newText, "Grounded coding newText is invalid.");
  const qualityCommandId = stringValue(
    output.qualityCommandId,
    "Grounded coding quality command is invalid.",
  );
  const file = binding.files.get(path);
  if (file === undefined) {
    throw new MissionDomainError(
      "Grounded coding provider selected a path outside trusted discovery.",
    );
  }
  if (!binding.qualityCommandIds.includes(qualityCommandId)) {
    throw new MissionDomainError(
      "Grounded coding provider selected an unregistered quality command.",
    );
  }
  const content = applyExactEdit(
    file.content,
    oldText,
    newText,
    "Grounded coding plan edit oldText was not found in trusted content.",
    "Grounded coding plan edit oldText is ambiguous in trusted content.",
    "Grounded coding plan edit does not change trusted content.",
  );
  const taskId = \`change-\${shortHash(\`\${binding.objective}\\u0000\${path}\`, 20)}\`;
  return {
    ...response,
    structuredOutput: {
      change: { content, expectedSha: file.sha, path },
      qualityCommandId,
      task: {
        definitionOfDone: [boundedText(binding.objective, 500)],
        dependsOn: [],
        id: taskId,
        priority: 10,
        title: boundedText(\`Apply requested change to \${path}\`, 500),
      },
    },
  };
}

function expandRepairResponse`,
  "expand plan response",
);

grounded = replaceRegexOnce(
  grounded,
  /function expandRepairResponse\([\s\S]*?\n\}\n\nfunction parsePlanBinding/u,
  `function expandRepairResponse(response: ModelResponse, binding: RepairBinding): ModelResponse {
  const output = jsonObject(
    response.structuredOutput,
    "Grounded coding repair is not a JSON object.",
  );
  try {
    validateToolInput(GROUNDED_CODING_REPAIR_SCHEMA, output);
  } catch {
    throw new MissionDomainError("Grounded coding repair failed schema validation.");
  }
  const oldText = stringValue(output.oldText, "Grounded coding repair oldText is invalid.");
  const newText = stringValueAllowEmpty(
    output.newText,
    "Grounded coding repair newText is invalid.",
  );
  const content = applyExactEdit(
    binding.currentFile.content,
    oldText,
    newText,
    "Grounded coding repair edit oldText was not found in current content.",
    "Grounded coding repair edit oldText is ambiguous in current content.",
    "Grounded coding repair edit does not change current content.",
  );
  return {
    ...response,
    structuredOutput: {
      content,
      expectedSha: binding.currentFile.sha,
      path: binding.currentFile.path,
    },
  };
}

function parsePlanBinding`,
  "expand repair response",
);

grounded = replaceOnce(
  grounded,
  `function stringArray(value: JsonValue | undefined, message: string): readonly string[] {`,
  `function stringValueAllowEmpty(value: JsonValue | undefined, message: string): string {
  if (typeof value !== "string") throw new MissionDomainError(message);
  return value;
}

function applyExactEdit(
  content: string,
  oldText: string,
  newText: string,
  missingMessage: string,
  ambiguousMessage: string,
  noChangeMessage: string,
): string {
  if (oldText === newText) throw new MissionDomainError(noChangeMessage);
  const first = content.indexOf(oldText);
  if (first < 0) throw new MissionDomainError(missingMessage);
  const next = content.indexOf(oldText, first + oldText.length);
  if (next >= 0) throw new MissionDomainError(ambiguousMessage);
  const result = \`\${content.slice(0, first)}\${newText}\${content.slice(first + oldText.length)}\`;
  if (result === content) throw new MissionDomainError(noChangeMessage);
  return result;
}

function stringArray(value: JsonValue | undefined, message: string): readonly string[] {`,
  "surgical helpers",
);
writeFileSync(groundedPath, grounded);

const evidencePath = "src/capability-packs/live-evidence.ts";
let evidence = readFileSync(evidencePath, "utf8");
evidence = replaceOnce(
  evidence,
  '  ["Grounded coding content is invalid.", "grounded_plan_content_invalid"],',
  `  ["Grounded coding content is invalid.", "grounded_plan_content_invalid"],
  ["Grounded coding oldText is invalid.", "grounded_plan_old_text_invalid"],
  ["Grounded coding newText is invalid.", "grounded_plan_new_text_invalid"],
  [
    "Grounded coding plan edit oldText was not found in trusted content.",
    "grounded_plan_edit_missing",
  ],
  [
    "Grounded coding plan edit oldText is ambiguous in trusted content.",
    "grounded_plan_edit_ambiguous",
  ],
  ["Grounded coding plan edit does not change trusted content.", "grounded_plan_edit_no_change"],`,
  "plan diagnostic map",
);
evidence = replaceOnce(
  evidence,
  '  ["Grounded coding repair content is invalid.", "grounded_repair_content_invalid"],',
  `  ["Grounded coding repair content is invalid.", "grounded_repair_content_invalid"],
  ["Grounded coding repair oldText is invalid.", "grounded_repair_old_text_invalid"],
  ["Grounded coding repair newText is invalid.", "grounded_repair_new_text_invalid"],
  [
    "Grounded coding repair edit oldText was not found in current content.",
    "grounded_repair_edit_missing",
  ],
  [
    "Grounded coding repair edit oldText is ambiguous in current content.",
    "grounded_repair_edit_ambiguous",
  ],
  ["Grounded coding repair edit does not change current content.", "grounded_repair_edit_no_change"],`,
  "repair diagnostic map",
);
evidence = replaceOnce(
  evidence,
  '  "grounded_plan_content_invalid",',
  `  "grounded_plan_content_invalid",
  "grounded_plan_edit_ambiguous",
  "grounded_plan_edit_missing",
  "grounded_plan_edit_no_change",
  "grounded_plan_new_text_invalid",
  "grounded_plan_old_text_invalid",`,
  "plan terminal codes",
);
evidence = replaceOnce(
  evidence,
  '  "grounded_repair_content_invalid",',
  `  "grounded_repair_content_invalid",
  "grounded_repair_edit_ambiguous",
  "grounded_repair_edit_missing",
  "grounded_repair_edit_no_change",
  "grounded_repair_new_text_invalid",
  "grounded_repair_old_text_invalid",`,
  "repair terminal codes",
);
writeFileSync(evidencePath, evidence);

const groundedTestPath = "test/runtime/grounded-coding-provider.test.ts";
let groundedTests = readFileSync(groundedTestPath, "utf8");
groundedTests = groundedTests
  .replace(
    `change: { content: FIXED_CONTENT, path: "src/user.ts" },`,
    `change: {
          newText: "  return canonicalizeId(value);",
          oldText: "  return value;",
          path: "src/user.ts",
        },`,
  )
  .replace('"odin_grounded_coding_plan_v1"', '"odin_grounded_coding_plan_v2"')
  .replace(
    'const inner = new ScriptedProvider([modelResponse({ content: FIXED_CONTENT }, 35, 15)]);',
    'const inner = new ScriptedProvider([modelResponse({ newText: "  return canonicalizeId(value);", oldText: "  return value;" }, 35, 15)]);',
  )
  .replace('"odin_grounded_coding_repair_v1"', '"odin_grounded_coding_repair_v2"')
  .replace(
    `change: { content: "export const compromised = true;\\n", path: "src/other.ts" },`,
    `change: {
          newText: "export const compromised = true;",
          oldText: "  return value;",
          path: "src/other.ts",
        },`,
  )
  .replace(
    'modelResponse({ change: { path: "src/user.ts" }, qualityCommandId: "verify" }, 10, 5)',
    'modelResponse({ change: { oldText: "  return value;", path: "src/user.ts" }, qualityCommandId: "verify" }, 10, 5)',
  );

if (!groundedTests.includes("grounded surgical edit rejects ambiguous and no-op model edits")) {
  groundedTests += `

test("grounded surgical edit rejects ambiguous and no-op model edits", async () => {
  const ambiguous = new ScriptedProvider([
    modelResponse(
      {
        change: { newText: "value", oldText: "value", path: "src/user.ts" },
        qualityCommandId: "verify",
      },
      10,
      5,
    ),
  ]);
  await assert.rejects(
    new GroundedCodingProvider(ambiguous).generate(planRequest(discovery())),
    (error: unknown) => {
      assert.ok(error instanceof MissionDomainError);
      assert.equal(error.message, "Grounded coding plan edit does not change trusted content.");
      return true;
    },
  );

  const duplicate = new ScriptedProvider([
    modelResponse(
      {
        change: { newText: "VALUE", oldText: "value", path: "src/user.ts" },
        qualityCommandId: "verify",
      },
      10,
      5,
    ),
  ]);
  await assert.rejects(
    new GroundedCodingProvider(duplicate).generate(planRequest(discovery())),
    (error: unknown) => {
      assert.ok(error instanceof MissionDomainError);
      assert.equal(error.message, "Grounded coding plan edit oldText is ambiguous in trusted content.");
      return true;
    },
  );
});
`;
}
writeFileSync(groundedTestPath, groundedTests);

const liveTestPath = "test/capability-packs/live-evidence.test.ts";
let liveTests = readFileSync(liveTestPath, "utf8");
if (!liveTests.includes("surgical grounded edit failures remain bounded terminal evidence")) {
  liveTests += `

test("surgical grounded edit failures remain bounded terminal evidence", () => {
  const messages = [
    ["Grounded coding plan edit oldText was not found in trusted content.", "grounded_plan_edit_missing"],
    ["Grounded coding plan edit oldText is ambiguous in trusted content.", "grounded_plan_edit_ambiguous"],
    ["Grounded coding plan edit does not change trusted content.", "grounded_plan_edit_no_change"],
    ["Grounded coding repair edit oldText was not found in current content.", "grounded_repair_edit_missing"],
    ["Grounded coding repair edit oldText is ambiguous in current content.", "grounded_repair_edit_ambiguous"],
    ["Grounded coding repair edit does not change current content.", "grounded_repair_edit_no_change"],
  ] as const;
  for (const [message, errorCode] of messages) {
    const diagnostic = classifyLiveFailure(new MissionDomainError(message));
    assert.deepEqual(diagnostic, { errorClass: "MissionDomainError", errorCode });
    assert.equal(isTerminalLiveMeasurementFailure(diagnostic), true, errorCode);
  }
});
`;
}
writeFileSync(liveTestPath, liveTests);

const analysisPath = "docs/evals/M16_KIMI_GROUNDED_STRENGTH_RUN_5_ANALYSIS.md";
writeFileSync(
  analysisPath,
  `# M16 Kimi K3 grounded strength run 5 analysis

Updated: 2026-09-04.

## Evidence

Authorized workflow \`33898932204\` completed successfully after full repository verification, build, and a credential-free strength dry-run. It used the bounded 16/16 provider calls across four matched NVIDIA \`moonshotai/kimi-k3\` baseline-vs-grounded cases. Sanitized evidence is \`docs/evals/m16-kimi-grounded-strength-run-5.json\`.

## Measured outcome

All four matched pairs are complete. Neither arm completed a case, so quality/completion lift is 0 and this run is not a quality win. Grounded Odin nevertheless reduced total tokens from 9,420 to 5,457 (**42.07%**) and aggregate latency from 588,336 ms to 565,906 ms (**3.81%**) with the same 8 provider calls per side.

## Failure pattern

The new telemetry makes the next defect concrete. Two grounded repair calls ended with \`finishReason=length\`; the other two grounded cases reached deterministic non-accepting/no-change repair outcomes. The v1 wrapper still asks Kimi to emit complete replacement files, which spends output budget on unchanged text and makes repair truncation/no-change more likely even for surgical objectives.

## Next change

M16 v2 converts the model-facing plan and repair contract to a **surgical exact-edit protocol**: model output selects a trusted path and returns one verbatim \`oldText\` plus replacement \`newText\`. Odin requires exactly one match in trusted current content, rejects missing/ambiguous/no-op edits, then expands the bounded edit into the existing full-file M4 contract while binding SHA/task metadata itself. Quality and M5 gates remain unchanged.

A further live comparison is valid only after v2 passes deterministic tests, full verify/build/dry-run, normal PR CI, and merge. Numeric lift remains specific to Kimi K3 / this profile / these task suites.
`,
);

const handoverPath = "HANDOVER.md";
let handover = readFileSync(handoverPath, "utf8");
if (!handover.includes("## M16 run-5 strength evidence — 2026-09-04")) {
  handover += `

## M16 run-5 strength evidence — 2026-09-04

Authorized NVIDIA/Kimi K3 strength run \`33898932204\` is preserved at \`docs/evals/m16-kimi-grounded-strength-run-5.json\`. All 4/4 matched pairs are measurement-complete. Neither legacy nor grounded M4 completed a strength case, so quality lift remains 0 and no model-superiority claim is valid. Grounded M4 used 5,457 vs 9,420 total tokens (**42.07% lower**) and 565,906 vs 588,336 ms aggregate latency (**3.81% lower**) with equal provider-call count (8 vs 8).

Telemetry localizes the next reliability defect: two grounded repair responses ended with \`finishReason=length\`; two other grounded cases ended in deterministic non-accepting/no-change repair outcomes. The next M16 tranche replaces model-facing full-file generation with exact bounded oldText/newText edits that Odin validates and expands against runtime-trusted repository content. SHA/task/path authority, M3 execution authority, M5 completion authority, and all quality gates remain unchanged.
`;
}
writeFileSync(handoverPath, handover);
