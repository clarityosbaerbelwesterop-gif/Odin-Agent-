import {
  type BudgetCounters,
  type MissionCreateInput,
  type MissionEventData,
  type MissionState,
  type MissionTaskInput,
  type TaskStatus,
  validateTaskGraph,
} from "../mission/runtime.js";
import type { JsonCodec } from "./types.js";
import { DurableStoreCorruptionError } from "./types.js";

const MISSION_STATES = new Set<MissionState>([
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
const FOCUS = new Set(["routine", "standard", "complex", "critical"]);
const COUNTER_KEYS: readonly (keyof BudgetCounters)[] = [
  "inputTokens",
  "outputTokens",
  "costMicros",
  "toolCalls",
  "attempts",
];

export const missionEventCodec: JsonCodec<MissionEventData> = Object.freeze({
  decode(value: unknown): MissionEventData {
    const event = objectValue(value, "mission event");
    const type = stringValue(event.type, "mission event type");
    if (type === "mission.created") {
      exactKeys(event, ["input", "type"], "mission.created");
      return {
        input: decodeMissionCreateInput(event.input),
        type: "mission.created",
      };
    }
    if (type === "mission.transitioned") {
      exactKeys(event, ["from", "to", "type"], "mission.transitioned");
      return {
        from: missionState(event.from, "mission transition source"),
        to: missionState(event.to, "mission transition destination"),
        type: "mission.transitioned",
      };
    }
    if (type === "task.status_changed") {
      exactKeys(event, ["status", "taskId", "type"], "task.status_changed");
      const status = stringValue(event.status, "task status") as TaskStatus;
      if (!TASK_STATUSES.has(status)) corrupt("Persisted task status is unsupported.");
      return {
        status,
        taskId: boundedString(event.taskId, "taskId", 200),
        type: "task.status_changed",
      };
    }
    if (type === "budget.debited") {
      exactKeys(event, ["delta", "type"], "budget.debited");
      return { delta: decodeCounters(event.delta, "budget delta"), type: "budget.debited" };
    }
    if (type === "failure.recorded") {
      exactKeys(event, ["signature", "type"], "failure.recorded");
      return {
        signature: boundedString(event.signature, "failure signature", 500),
        type: "failure.recorded",
      };
    }
    return corrupt("Persisted mission event type is unsupported.");
  },
});

function decodeMissionCreateInput(value: unknown): MissionCreateInput {
  const input = objectValue(value, "mission create input");
  exactKeys(input, ["budgetLimits", "focus", "id", "objective", "tasks"], "mission create input");
  const focus = stringValue(input.focus, "focus");
  if (!FOCUS.has(focus)) corrupt("Persisted mission focus is unsupported.");
  if (!Array.isArray(input.tasks)) corrupt("Persisted mission tasks must be an array.");
  const tasks = input.tasks.map(decodeTask);
  try {
    validateTaskGraph(tasks);
  } catch {
    return corrupt("Persisted mission task graph is invalid.");
  }
  return {
    budgetLimits: decodeCounters(input.budgetLimits, "budget limits"),
    focus: focus as MissionCreateInput["focus"],
    id: boundedString(input.id, "mission id", 200),
    objective: boundedString(input.objective, "mission objective", 20_000),
    tasks,
  };
}

function decodeTask(value: unknown): MissionTaskInput {
  const task = objectValue(value, "mission task");
  const allowed = new Set(["definitionOfDone", "dependsOn", "id", "priority", "title"]);
  for (const key of Object.keys(task)) {
    if (!allowed.has(key)) corrupt(`Persisted mission task contains unknown field ${key}.`);
  }
  if (!Array.isArray(task.definitionOfDone)) corrupt("definitionOfDone must be an array.");
  const definitionOfDone = task.definitionOfDone.map((item) =>
    boundedString(item, "definitionOfDone item", 1_000),
  );
  if (definitionOfDone.length === 0 || definitionOfDone.length > 100) {
    corrupt("definitionOfDone count is out of bounds.");
  }
  let dependsOn: readonly string[] | undefined;
  if (task.dependsOn !== undefined) {
    if (!Array.isArray(task.dependsOn)) corrupt("dependsOn must be an array.");
    dependsOn = task.dependsOn.map((item) => boundedString(item, "dependency id", 200));
  }
  let priority: number | undefined;
  if (task.priority !== undefined) {
    priority = safeInteger(task.priority, "task priority", 0, 100);
  }
  const result: MissionTaskInput = {
    definitionOfDone,
    id: boundedString(task.id, "task id", 200),
    title: boundedString(task.title, "task title", 1_000),
  };
  if (dependsOn !== undefined) return priority === undefined ? { ...result, dependsOn } : { ...result, dependsOn, priority };
  return priority === undefined ? result : { ...result, priority };
}

function decodeCounters(value: unknown, label: string): BudgetCounters {
  const counters = objectValue(value, label);
  exactKeys(counters, [...COUNTER_KEYS], label);
  return {
    attempts: safeInteger(counters.attempts, `${label}.attempts`),
    costMicros: safeInteger(counters.costMicros, `${label}.costMicros`),
    inputTokens: safeInteger(counters.inputTokens, `${label}.inputTokens`),
    outputTokens: safeInteger(counters.outputTokens, `${label}.outputTokens`),
    toolCalls: safeInteger(counters.toolCalls, `${label}.toolCalls`),
  };
}

function missionState(value: unknown, label: string): MissionState {
  const state = stringValue(value, label) as MissionState;
  if (!MISSION_STATES.has(state)) corrupt(`${label} is unsupported.`);
  return state;
}

function exactKeys(object: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  if (Object.keys(object).length !== expected.size) corrupt(`${label} has an unexpected field count.`);
  for (const key of Object.keys(object)) {
    if (!expected.has(key)) corrupt(`${label} contains unknown field ${key}.`);
  }
  for (const key of expected) {
    if (!(key in object)) corrupt(`${label} is missing field ${key}.`);
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    corrupt(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") corrupt(`${label} must be text.`);
  return value;
}

function boundedString(value: unknown, label: string, maxLength: number): string {
  const text = stringValue(value, label);
  if (text.trim() === "" || text.length > maxLength || text.includes("\u0000")) {
    corrupt(`${label} is empty or exceeds its bound.`);
  }
  return text;
}

function safeInteger(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    corrupt(`${label} is not a valid safe integer.`);
  }
  return value;
}

function corrupt(message: string): never {
  throw new DurableStoreCorruptionError(message);
}
