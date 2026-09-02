import { createHash } from "node:crypto";
import type { MissionCheckpoint } from "../mission/checkpoint.js";
import {
  type BudgetCounters,
  type MissionCreateInput,
  MissionDomainError,
  type MissionSnapshot,
  type MissionTaskInput,
} from "../mission/runtime.js";
import type {
  JsonArray,
  JsonObject,
  JsonValue,
  ModelResponse,
  TokenUsage,
} from "../providers/types.js";
import { validateToolInput } from "../tools/schema.js";
import type { ToolAuditRecord } from "../tools/types.js";

export const BOOTSTRAP_TASK_ID = "__m4_bootstrap__";
export const QUALITY_TASK_ID = "__m4_quality__";
export const TOOL_VERSION = "1";
export const MAX_RELEVANT_FILES = 4;
export const MAX_FILE_BYTES = 20_000;

const QUALITY_PREFIX = "quality:";
const CHANGED_FILE_PREFIX = "changed-file:";

export const ZERO_COUNTERS: BudgetCounters = Object.freeze({
  attempts: 0,
  costMicros: 0,
  inputTokens: 0,
  outputTokens: 0,
  toolCalls: 0,
});

export const CODING_PLAN_SCHEMA: JsonObject = {
  additionalProperties: false,
  properties: {
    change: {
      additionalProperties: false,
      properties: {
        content: { maxLength: 100_000, minLength: 1, type: "string" },
        expectedSha: { maxLength: 128, minLength: 1, type: "string" },
        path: { maxLength: 500, minLength: 1, type: "string" },
      },
      required: ["content", "expectedSha", "path"],
      type: "object",
    },
    qualityCommandId: { maxLength: 100, minLength: 1, type: "string" },
    task: {
      additionalProperties: false,
      properties: {
        definitionOfDone: {
          items: { maxLength: 500, minLength: 1, type: "string" },
          maxItems: 8,
          minItems: 1,
          type: "array",
        },
        dependsOn: {
          items: { maxLength: 100, minLength: 1, type: "string" },
          maxItems: 0,
          minItems: 0,
          type: "array",
        },
        id: { maxLength: 100, minLength: 1, type: "string" },
        priority: { maximum: 100, minimum: 0, type: "integer" },
        title: { maxLength: 500, minLength: 1, type: "string" },
      },
      required: ["definitionOfDone", "dependsOn", "id", "priority", "title"],
      type: "object",
    },
  },
  required: ["change", "qualityCommandId", "task"],
  type: "object",
};

export const CODING_REPAIR_SCHEMA: JsonObject = {
  additionalProperties: false,
  properties: {
    content: { maxLength: 100_000, minLength: 1, type: "string" },
    expectedSha: { maxLength: 128, minLength: 1, type: "string" },
    path: { maxLength: 500, minLength: 1, type: "string" },
  },
  required: ["content", "expectedSha", "path"],
  type: "object",
};

export interface ToolAuditReader {
  records(): readonly ToolAuditRecord[];
}

export interface CodingStartInput {
  readonly missionId: string;
  readonly objective: string;
  readonly budgetLimits: BudgetCounters;
  readonly focus?: MissionCreateInput["focus"];
}

export interface CodingRunOptions {
  readonly interruptAfterFirstFailure?: boolean;
}

export interface RepositoryFileEvidence {
  readonly path: string;
  readonly sha: string;
  readonly content: string;
  readonly truncated: boolean;
}

export interface RepositoryDiscovery {
  readonly query: string;
  readonly relevantFiles: readonly RepositoryFileEvidence[];
  readonly packageJson: string;
  readonly qualityCommandIds: readonly string[];
}

export interface CodingQualityEvidence {
  readonly commandId: string;
  readonly firstFailureSignature: string | null;
  readonly finalExitCode: number;
}

export interface CodingFinalReport {
  readonly missionId: string;
  readonly state: "COMPLETED";
  readonly taskStatuses: Readonly<Record<string, string>>;
  readonly modelUsage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  readonly toolCalls: number;
  readonly attempts: number;
  readonly changedFiles: readonly string[];
  readonly quality: CodingQualityEvidence;
  readonly auditReferences: readonly string[];
  readonly limitations: readonly string[];
}

export interface CodingInterruptedResult {
  readonly status: "interrupted";
  readonly mission: MissionSnapshot;
  readonly checkpoint: MissionCheckpoint;
  readonly failureSignature: string;
}

export interface CodingCompletedResult {
  readonly status: "completed";
  readonly report: CodingFinalReport;
}

export type CodingRunResult = CodingCompletedResult | CodingInterruptedResult;

export interface CodingChange {
  readonly path: string;
  readonly expectedSha: string;
  readonly content: string;
}

export type CodingRepair = CodingChange;

export interface CodingPlan {
  readonly task: MissionTaskInput;
  readonly change: CodingChange;
  readonly qualityCommandId: string;
}

export interface QualityRunResult {
  readonly snapshot: MissionSnapshot;
  readonly commandId: string;
  readonly exitCode: number;
  readonly output: string;
}

export function parsePlan(response: ModelResponse): CodingPlan {
  const output = response.structuredOutput;
  if (!isJsonObject(output)) {
    throw new MissionDomainError("Planning provider did not return a structured JSON object.");
  }
  validateToolInput(CODING_PLAN_SCHEMA, output);
  const task = objectField(output, "task");
  const change = objectField(output, "change");
  return {
    change: {
      content: stringField(change, "content"),
      expectedSha: stringField(change, "expectedSha"),
      path: stringField(change, "path"),
    },
    qualityCommandId: stringField(output, "qualityCommandId"),
    task: {
      definitionOfDone: stringArrayField(task, "definitionOfDone"),
      dependsOn: stringArrayField(task, "dependsOn"),
      id: stringField(task, "id"),
      priority: integerField(task, "priority"),
      title: stringField(task, "title"),
    },
  };
}

export function parseRepair(response: ModelResponse): CodingRepair {
  const output = response.structuredOutput;
  if (!isJsonObject(output)) {
    throw new MissionDomainError("Repair provider did not return a structured JSON object.");
  }
  validateToolInput(CODING_REPAIR_SCHEMA, output);
  return {
    content: stringField(output, "content"),
    expectedSha: stringField(output, "expectedSha"),
    path: stringField(output, "path"),
  };
}

export function planTasks(plan: CodingPlan): readonly MissionTaskInput[] {
  rejectReservedDefinitionMarkers(plan.task.definitionOfDone);
  if (plan.task.id === QUALITY_TASK_ID || plan.task.id === BOOTSTRAP_TASK_ID) {
    throw new MissionDomainError("Model task id collides with an Odin-reserved task id.");
  }
  return [
    {
      ...plan.task,
      definitionOfDone: [
        ...plan.task.definitionOfDone,
        `${CHANGED_FILE_PREFIX}${plan.change.path}`,
      ],
    },
    {
      definitionOfDone: [`${QUALITY_PREFIX}${plan.qualityCommandId}`],
      dependsOn: [plan.task.id],
      id: QUALITY_TASK_ID,
      priority: 0,
      title: `Verify registered quality command ${plan.qualityCommandId}`,
    },
  ];
}

export function validatePlanAgainstDiscovery(
  plan: CodingPlan,
  discovery: RepositoryDiscovery,
): void {
  const target = discovery.relevantFiles.find((file) => file.path === plan.change.path);
  if (target === undefined) {
    throw new MissionDomainError("Model plan targets a file outside bounded repository discovery.");
  }
  if (target.sha !== plan.change.expectedSha) {
    throw new MissionDomainError(
      "Model plan expectedSha does not match discovered repository state.",
    );
  }
  if (target.content === plan.change.content) {
    throw new MissionDomainError("Model plan does not change the target file.");
  }
  if (!discovery.qualityCommandIds.includes(plan.qualityCommandId)) {
    throw new MissionDomainError("Model plan selected an unregistered quality command.");
  }
  if (plan.task.dependsOn?.length !== 0) {
    throw new MissionDomainError("The M4 model change task must be dependency-free.");
  }
}

export function validateRepair(
  repair: CodingRepair,
  targetPath: string,
  current: RepositoryFileEvidence,
): void {
  if (repair.path !== targetPath) {
    throw new MissionDomainError("Repair proposal may not change the persisted target path.");
  }
  if (repair.expectedSha !== current.sha) {
    throw new MissionDomainError("Repair expectedSha is stale or mismatched.");
  }
  if (repair.content === current.content) {
    throw new MissionDomainError("Repair proposal does not change the target file.");
  }
}

export function parseSearchPaths(output: JsonObject): string[] {
  const matches = arrayField(output, "matches");
  const paths = matches.map((entry) =>
    stringField(asObject(entry, "Search match must be an object."), "path"),
  );
  return [...new Set(paths)].sort();
}

export function parseReadFile(path: string, output: JsonObject): RepositoryFileEvidence {
  return {
    content: stringField(output, "content"),
    path,
    sha: stringField(output, "sha"),
    truncated: booleanField(output, "truncated"),
  };
}

export function qualityFailureSignature(result: QualityRunResult): string {
  return `quality:${result.commandId}:exit:${result.exitCode}:sha256:${shortHash(result.output, 32)}`;
}

export function latestFailureSignature(snapshot: MissionSnapshot): string {
  const signatures = Object.entries(snapshot.failureCounts)
    .filter(([, count]) => count > 0)
    .map(([signature]) => signature)
    .sort();
  const latest = signatures.at(-1);
  if (latest === undefined) throw new MissionDomainError("Resume state has no recorded failure.");
  return latest;
}

export function changedFileFromMission(snapshot: MissionSnapshot): string {
  const task = changeTaskFromMission(snapshot);
  const marker = task.definitionOfDone.find((item) => item.startsWith(CHANGED_FILE_PREFIX));
  if (marker === undefined) {
    throw new MissionDomainError("Mission is missing its changed-file marker.");
  }
  const path = marker.slice(CHANGED_FILE_PREFIX.length);
  if (path.trim() === "") throw new MissionDomainError("Mission changed-file marker is empty.");
  return path;
}

export function qualityCommandFromMission(snapshot: MissionSnapshot): string {
  const task = snapshot.tasks.find((candidate) => candidate.id === QUALITY_TASK_ID);
  if (task === undefined) throw new MissionDomainError("Mission is missing the M4 quality task.");
  const marker = task.definitionOfDone.find((item) => item.startsWith(QUALITY_PREFIX));
  if (marker === undefined) {
    throw new MissionDomainError("Mission is missing its quality command marker.");
  }
  const commandId = marker.slice(QUALITY_PREFIX.length);
  if (commandId.trim() === "") throw new MissionDomainError("Mission quality marker is empty.");
  return commandId;
}

export function changeTaskFromMission(snapshot: MissionSnapshot): MissionSnapshot["tasks"][number] {
  const task = snapshot.tasks.find(
    (candidate) =>
      candidate.id !== QUALITY_TASK_ID &&
      candidate.definitionOfDone.some((item) => item.startsWith(CHANGED_FILE_PREFIX)),
  );
  if (task === undefined) throw new MissionDomainError("Mission is missing the M4 change task.");
  return task;
}

export function validateStartInput(input: CodingStartInput): void {
  if (input.missionId.trim() === "" || input.objective.trim() === "") {
    throw new TypeError("M4 missionId and objective must be non-empty.");
  }
  for (const value of Object.values(input.budgetLimits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("M4 budget limits must be non-negative safe integers.");
    }
  }
  if (input.budgetLimits.toolCalls < 4 || input.budgetLimits.attempts < 6) {
    throw new TypeError(
      "M4 requires bounded headroom for discovery, planning, verification, and repair.",
    );
  }
}

export function validateUsage(usage: TokenUsage): void {
  for (const value of [usage.inputTokens, usage.outputTokens, usage.totalTokens]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new MissionDomainError("Provider token usage must use non-negative safe integers.");
    }
  }
  if (usage.totalTokens < usage.inputTokens + usage.outputTokens) {
    throw new MissionDomainError("Provider total token usage is inconsistent.");
  }
}

export function usageDelta(usage: TokenUsage): BudgetCounters {
  return {
    ...ZERO_COUNTERS,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}

export function searchQuery(objective: string): string {
  const ignored = new Set([
    "and",
    "change",
    "fix",
    "for",
    "implement",
    "make",
    "repair",
    "the",
    "update",
    "with",
  ]);
  const tokens = objective.toLowerCase().match(/[a-z0-9_]{3,}/gu) ?? [];
  return tokens.find((token) => !ignored.has(token)) ?? tokens[0] ?? objective.trim().slice(0, 64);
}

export function isRelevantRepositoryPath(path: string): boolean {
  if (path === "package.json") return false;
  return !(
    path.startsWith("node_modules/") ||
    path.startsWith("dist/") ||
    path.startsWith(".git/") ||
    path.endsWith(".lock") ||
    path.endsWith(".png") ||
    path.endsWith(".jpg") ||
    path.endsWith(".jpeg") ||
    path.endsWith(".gif")
  );
}

export function planPrompt(objective: string, discovery: RepositoryDiscovery): string {
  const files = discovery.relevantFiles.map((file) => ({
    content: boundedText(file.content, 6_000),
    path: file.path,
    sha: file.sha,
    truncated: file.truncated,
  }));
  return JSON.stringify({
    objective,
    packageJson: boundedText(discovery.packageJson, 4_000),
    qualityCommandIds: discovery.qualityCommandIds,
    relevantFiles: files,
  });
}

export function repairPrompt(
  objective: string,
  path: string,
  file: RepositoryFileEvidence,
  qualityCommandId: string,
  failureSignature: string,
  failureEvidence: string,
): string {
  return JSON.stringify({
    currentFile: {
      content: boundedText(file.content, 8_000),
      path,
      sha: file.sha,
    },
    failureEvidence: boundedText(failureEvidence, 2_000),
    failureSignature,
    objective,
    qualityCommandId,
  });
}

export function auditReference(record: ToolAuditRecord, index: number): string {
  return `${index + 1}:${record.tool}@${record.version}:${record.resultClass}:${record.inputHash.slice(0, 12)}:${record.resourceHash.slice(0, 12)}`;
}

export function eventKey(snapshot: MissionSnapshot, label: string): string {
  return `m4:${snapshot.id}:v${snapshot.version}:${label}`;
}

export function grantExpiry(now: string): string {
  const parsed = Date.parse(now);
  if (Number.isNaN(parsed)) throw new TypeError("M4 clock must return a parseable timestamp.");
  return new Date(parsed + 10 * 60_000).toISOString();
}

export function boundedText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

export function shortHash(value: string, length = 16): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function stringField(object: JsonObject, name: string): string {
  const value = object[name];
  if (typeof value !== "string") throw new MissionDomainError(`${name} must be a string.`);
  return value;
}

export function integerField(object: JsonObject, name: string): number {
  const value = object[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new MissionDomainError(`${name} must be a safe integer.`);
  }
  return value;
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectReservedDefinitionMarkers(values: readonly string[]): void {
  if (
    values.some(
      (value) => value.startsWith(QUALITY_PREFIX) || value.startsWith(CHANGED_FILE_PREFIX),
    )
  ) {
    throw new MissionDomainError(
      "Model definitions of done may not use Odin-reserved evidence markers.",
    );
  }
}

function objectField(object: JsonObject, name: string): JsonObject {
  return asObject(object[name], `${name} must be an object.`);
}

function booleanField(object: JsonObject, name: string): boolean {
  const value = object[name];
  if (typeof value !== "boolean") throw new MissionDomainError(`${name} must be a boolean.`);
  return value;
}

function stringArrayField(object: JsonObject, name: string): readonly string[] {
  const value = object[name];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new MissionDomainError(`${name} must be a string array.`);
  }
  return [...value];
}

function arrayField(object: JsonObject, name: string): JsonArray {
  const value = object[name];
  if (!Array.isArray(value)) throw new MissionDomainError(`${name} must be an array.`);
  return value;
}

function asObject(value: JsonValue | undefined, message: string): JsonObject {
  if (!isJsonObject(value)) throw new MissionDomainError(message);
  return value;
}
