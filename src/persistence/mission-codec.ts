import {
  type BudgetCounters,
  type FocusClass,
  type MissionCreateInput,
  type MissionEventData,
  type MissionState,
  type MissionTaskInput,
  type TaskStatus,
  validateTaskGraph,
} from "../mission/runtime.js";
import type { PersistenceCodec } from "./events.js";
import { PersistenceCorruptionError } from "./sqlite.js";

const STATES = new Set<MissionState>([
  "CREATED",
  "UNDERSTANDING",
  "RETRIEVING",
  "PLANNING",
  "RISK_CHECK",
  "EXECUTING",
  "OBSERVING",
  "VERIFYING",
  "DIAGNOSING",
  "REPAIRING",
  "CHECKPOINTING",
  "FINAL_AUDIT",
  "PAUSING",
  "PAUSED",
  "RESUMING",
  "CANCELLING",
  "COMPLETED",
  "CANCELLED",
  "BLOCKED",
  "FAILED",
]);
const TASK_STATUSES = new Set<TaskStatus>([
  "PENDING",
  "RUNNING",
  "VERIFIED",
  "FAILED",
  "CANCELLED",
]);
const FOCUS_CLASSES = new Set<FocusClass>(["routine", "standard", "complex", "critical"]);

export const missionEventCodec: PersistenceCodec<MissionEventData> = {
  encode: (value) => structuredClone(value),
  decode: decodeMissionEventData,
};

export function decodeMissionEventData(value: unknown): MissionEventData {
  const object = asObject(value, "mission event");
  const type = readString(object.type, "mission event type");
  if (type === "mission.created") {
    assertKeys(object, ["type", "input"], "mission.created");
    return { input: decodeMissionCreateInput(object.input), type };
  }
  if (type === "mission.transitioned") {
    assertKeys(object, ["type", "from", "to"], "mission.transitioned");
    return {
      from: readEnum(object.from, STATES, "mission transition from"),
      to: readEnum(object.to, STATES, "mission transition to"),
      type,
    };
  }
  if (type === "task.status_changed") {
    assertKeys(object, ["type", "taskId", "status"], "task.status_changed");
    return {
      status: readEnum(object.status, TASK_STATUSES, "task status"),
      taskId: readIdentifier(object.taskId, "task id"),
      type,
    };
  }
  if (type === "budget.debited") {
    assertKeys(object, ["type", "delta"], "budget.debited");
    return { delta: decodeCounters(object.delta), type };
  }
  if (type === "failure.recorded") {
    assertKeys(object, ["type", "signature"], "failure.recorded");
    return { signature: readIdentifier(object.signature, "failure signature"), type };
  }
  throw new PersistenceCorruptionError("Persisted mission event type is unknown.");
}

function decodeMissionCreateInput(value: unknown): MissionCreateInput {
  const object = asObject(value, "mission create input");
  assertKeys(object, ["id", "objective", "focus", "tasks", "budgetLimits"], "mission create input");
  if (!Array.isArray(object.tasks) || object.tasks.length > 1024) {
    throw new PersistenceCorruptionError("Persisted mission task list is malformed.");
  }
  const tasks = object.tasks.map(decodeTaskInput);
  validateTaskGraph(tasks);
  return {
    budgetLimits: decodeCounters(object.budgetLimits),
    focus: readEnum(object.focus, FOCUS_CLASSES, "mission focus"),
    id: readIdentifier(object.id, "mission id"),
    objective: readBoundedString(object.objective, "mission objective", 16_384),
    tasks,
  };
}

function decodeTaskInput(value: unknown): MissionTaskInput {
  const object = asObject(value, "mission task");
  const allowed = new Set(["id", "title", "dependsOn", "definitionOfDone", "priority"]);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new PersistenceCorruptionError("Persisted mission task has unknown fields.");
  }
  const definitionOfDone = readStringArray(object.definitionOfDone, "task definition of done", 128);
  const dependsOn = object.dependsOn === undefined
    ? undefined
    : readIdentifierArray(object.dependsOn, "task dependencies", 1024);
  const priority = object.priority === undefined
    ? undefined
    : readSafeInteger(object.priority, "task priority", -1_000_000, 1_000_000);
  return {
    definitionOfDone,
    ...(dependsOn === undefined ? {} : { dependsOn }),
    id: readIdentifier(object.id, "task id"),
    ...(priority === undefined ? {} : { priority }),
    title: readBoundedString(object.title, "task title", 4096),
  };
}

function decodeCounters(value: unknown): BudgetCounters {
  const object = asObject(value, "budget counters");
  assertKeys(
    object,
    ["inputTokens", "outputTokens", "costMicros", "toolCalls", "attempts"],
    "budget counters",
  );
  return {
    attempts: readSafeInteger(object.attempts, "attempts", 0),
    costMicros: readSafeInteger(object.costMicros, "costMicros", 0),
    inputTokens: readSafeInteger(object.inputTokens, "inputTokens", 0),
    outputTokens: readSafeInteger(object.outputTokens, "outputTokens", 0),
    toolCalls: readSafeInteger(object.toolCalls, "toolCalls", 0),
  };
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PersistenceCorruptionError(`Persisted ${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertKeys(object: Record<string, unknown>, keys: readonly string[], name: string): void {
  const expected = new Set(keys);
  if (Object.keys(object).length !== expected.size) {
    throw new PersistenceCorruptionError(`Persisted ${name} has an invalid field set.`);
  }
  for (const key of Object.keys(object)) {
    if (!expected.has(key)) {
      throw new PersistenceCorruptionError(`Persisted ${name} has an unknown field.`);
    }
  }
}

function readString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new PersistenceCorruptionError(`Persisted ${name} is malformed.`);
  return value;
}

function readBoundedString(value: unknown, name: string, maxLength: number): string {
  const result = readString(value, name);
  if (result.trim() === "" || result.length > maxLength || result.includes("\u0000")) {
    throw new PersistenceCorruptionError(`Persisted ${name} is out of bounds.`);
  }
  return result;
}

function readIdentifier(value: unknown, name: string): string {
  return readBoundedString(value, name, 256);
}

function readEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>, name: string): T {
  const result = readString(value, name) as T;
  if (!allowed.has(result)) throw new PersistenceCorruptionError(`Persisted ${name} is unsupported.`);
  return result;
}

function readSafeInteger(value: unknown, name: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new PersistenceCorruptionError(`Persisted ${name} is malformed.`);
  }
  return value;
}

function readStringArray(value: unknown, name: string, maxItems: number): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw new PersistenceCorruptionError(`Persisted ${name} is malformed.`);
  }
  return value.map((entry) => readBoundedString(entry, name, 4096));
}

function readIdentifierArray(value: unknown, name: string, maxItems: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new PersistenceCorruptionError(`Persisted ${name} is malformed.`);
  }
  const result = value.map((entry) => readIdentifier(entry, name));
  if (new Set(result).size !== result.length) {
    throw new PersistenceCorruptionError(`Persisted ${name} contains duplicates.`);
  }
  return result;
}
