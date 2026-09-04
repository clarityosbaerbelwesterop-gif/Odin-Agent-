import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryEventStore } from "../../src/events/store.js";
import { type MissionEventData, MissionRuntime } from "../../src/mission/runtime.js";
import { CodingOrchestrator } from "../../src/runtime/coding.js";
import { InMemoryToolAuditSink } from "../../src/tools/audit.js";
import { InMemoryCapabilityPolicy } from "../../src/tools/policy.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import {
  createRepositoryToolRegistrations,
  type QualityCommandResult,
  type QualityCommandRunner,
} from "../../src/tools/repository.js";
import { ToolRuntime } from "../../src/tools/runtime.js";
import { IndependentVerificationEngine } from "../../src/verification/engine.js";
import {
  FIXED_NOW,
  FixtureWorkspace,
  modelResponse,
  ScriptedProvider,
} from "../runtime/coding-fixtures.js";

interface ControlCase {
  readonly id: string;
  readonly objective: string;
  readonly targetPath: string;
  readonly files: Readonly<Record<string, string>>;
  readonly expected: string;
  readonly accepts: (content: string) => boolean;
}

const CASES: readonly ControlCase[] = Object.freeze([
  Object.freeze({
    id: "canonical-user-id",
    objective:
      "Canonicalize selectUserId consistently with canonicalizeId while preserving the existing exports.",
    targetPath: "src/user.ts",
    files: Object.freeze({
      "README.md": "Identity values must be canonicalized consistently across the repository.",
      "package.json": JSON.stringify({ name: "m15-kimi-case-identity", private: true }),
      "src/identity.ts":
        "export function canonicalizeId(value: string): string {\n  return value.trim().toLowerCase();\n}\n",
      "src/user.ts":
        'import { canonicalizeId } from "./identity.js";\n\nexport function selectUserId(value: string): string {\n  return value;\n}\n',
    }),
    expected:
      'import { canonicalizeId } from "./identity.js";\n\nexport function selectUserId(value: string): string {\n  return canonicalizeId(value);\n}\n',
    accepts: (content: string) =>
      content.includes('import { canonicalizeId } from "./identity.js";') &&
      content.includes("return canonicalizeId(value);") &&
      content.includes("export function selectUserId(value: string): string"),
  }),
  Object.freeze({
    id: "retry-429-surgical",
    objective:
      "Repair shouldRetry so HTTP 429 is retryable without changing retryDelayMs or the API.",
    targetPath: "src/retry.ts",
    files: Object.freeze({
      "README.md": "Retry policy treats throttling and transient server failures as retryable.",
      "package.json": JSON.stringify({ name: "m15-kimi-case-retry", private: true }),
      "src/retry.ts":
        "export function shouldRetry(status: number): boolean {\n  if (status === 429) return false;\n  if (status >= 500) return true;\n  return false;\n}\n\nexport function retryDelayMs(attempt: number): number {\n  return Math.min(1000 * 2 ** attempt, 8000);\n}\n",
    }),
    expected:
      "export function shouldRetry(status: number): boolean {\n  if (status === 429) return true;\n  if (status >= 500) return true;\n  return false;\n}\n\nexport function retryDelayMs(attempt: number): number {\n  return Math.min(1000 * 2 ** attempt, 8000);\n}\n",
    accepts: (content: string) =>
      content.includes("if (status === 429) return true;") &&
      content.includes(
        "export function retryDelayMs(attempt: number): number {\n  return Math.min(1000 * 2 ** attempt, 8000);\n}",
      ),
  }),
  Object.freeze({
    id: "safe-trim-existing-api",
    objective:
      "safeTrim parseLabel input using the existing repository helper while preserving internal whitespace and the exported API.",
    targetPath: "src/label.ts",
    files: Object.freeze({
      "README.md": "Labels preserve internal whitespace and remove only surrounding whitespace.",
      "package.json": JSON.stringify({ name: "m15-kimi-case-label", private: true }),
      "src/label.ts":
        'import { safeTrim } from "./text.js";\n\nexport function parseLabel(value: string): string {\n  return value;\n}\n',
      "src/text.ts":
        'export function safeTrim(value: string): string {\n  return value.trim();\n}\n\nexport function collapseWhitespace(value: string): string {\n  return value.replace(/\\s+/g, " " ).trim();\n}\n',
    }),
    expected:
      'import { safeTrim } from "./text.js";\n\nexport function parseLabel(value: string): string {\n  return safeTrim(value);\n}\n',
    accepts: (content: string) =>
      content.includes('import { safeTrim } from "./text.js";') &&
      content.includes("return safeTrim(value);") &&
      content.includes("export function parseLabel(value: string): string"),
  }),
]);

class ControlQualityRunner implements QualityCommandRunner {
  readonly #workspace: FixtureWorkspace;
  readonly #caseSpec: ControlCase;

  constructor(workspace: FixtureWorkspace, caseSpec: ControlCase) {
    this.#workspace = workspace;
    this.#caseSpec = caseSpec;
  }

  commands() {
    return [{ id: "verify", label: `M15 ${this.#caseSpec.id} control verification` }];
  }

  async run(commandId: string, signal: AbortSignal): Promise<QualityCommandResult> {
    if (signal.aborted) throw new Error("Control quality run aborted.");
    if (commandId !== "verify") throw new Error("Unknown control quality command.");
    const accepted = this.#caseSpec.accepts(this.#workspace.content(this.#caseSpec.targetPath));
    return accepted
      ? { exitCode: 0, output: `m15 control ${this.#caseSpec.id} passed` }
      : { exitCode: 1, output: `m15 control ${this.#caseSpec.id} failed` };
  }
}

for (const caseSpec of CASES) {
  test(`offline control proves live fixture ${caseSpec.id} is solvable through Odin M4/M5`, async () => {
    const workspace = new FixtureWorkspace(caseSpec.files);
    const quality = new ControlQualityRunner(workspace, caseSpec);
    const audit = new InMemoryToolAuditSink();
    const policy = new InMemoryCapabilityPolicy();
    const tools = new ToolRuntime(
      new ToolRegistry(createRepositoryToolRegistrations({ quality, workspace })),
      policy,
      audit,
      () => FIXED_NOW,
    );
    const mission = new MissionRuntime(
      new InMemoryEventStore<MissionEventData>(),
      () => FIXED_NOW,
    );
    const taskId = `change-${caseSpec.id}`;
    const provider = new ScriptedProvider([
      modelResponse(
        {
          change: {
            content: caseSpec.expected,
            expectedSha: workspace.sha(caseSpec.targetPath),
            path: caseSpec.targetPath,
          },
          qualityCommandId: "verify",
          task: {
            definitionOfDone: [caseSpec.objective],
            dependsOn: [],
            id: taskId,
            priority: 10,
            title: `Solve ${caseSpec.id}`,
          },
        },
        40,
        20,
      ),
    ]);
    const coding = new CodingOrchestrator({
      audit,
      clock: () => FIXED_NOW,
      grants: policy,
      mission,
      model: "fixture-model",
      provider,
      quality,
      tools,
      verification: new IndependentVerificationEngine({ maxEvidenceAgeMs: 60_000 }),
    });

    const result = await coding.start({
      budgetLimits: {
        attempts: 40,
        costMicros: 0,
        inputTokens: 40_000,
        outputTokens: 20_000,
        toolCalls: 40,
      },
      missionId: `m15-control-${caseSpec.id}`,
      objective: caseSpec.objective,
    });

    assert.equal(result.status, "completed");
    if (result.status !== "completed") return;
    assert.equal(result.report.state, "COMPLETED");
    assert.equal(result.report.taskStatuses[taskId], "VERIFIED");
    assert.equal(result.report.taskStatuses.__m4_quality__, "VERIFIED");
    assert.equal(result.report.quality.finalExitCode, 0);
    assert.equal(result.report.quality.firstFailureSignature, null);
    assert.equal(result.report.verification.outcome, "PASS");
    assert.deepEqual(result.report.changedFiles, [caseSpec.targetPath]);
    assert.equal(workspace.content(caseSpec.targetPath), caseSpec.expected);
    assert.equal(provider.requests.length, 1);
  });
}
