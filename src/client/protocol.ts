import type { JobLifecycleEvent } from "../durable/types.js";
import type { MissionSnapshot } from "../mission/runtime.js";
import {
  CLIENT_PROTOCOL_VERSION,
  type ClientCapabilityGrant,
  type ClientCommandName,
  type ClientCommandRequest,
  type ClientJobCounts,
  type ClientLifecycleEvent,
  type ClientMissionProjection,
  ClientProtocolError,
  type ClientProtocolVersion,
  type ClientStateRequest,
  type ClientStateResponse,
  type ClientVerificationSummary,
} from "./types.js";

const COMMANDS = new Set<ClientCommandName>(["mission.pause", "mission.resume", "mission.cancel"]);
const MISSION_STATES = new Set([
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
const FOCUS = new Set(["routine", "standard", "complex", "critical"]);
const TASK_STATUSES = new Set(["PENDING", "RUNNING", "VERIFIED", "FAILED", "CANCELLED"]);
const JOB_STATUSES = [
  "PENDING",
  "RUNNING",
  "RETRY_WAIT",
  "CANCELLING",
  "CANCELLED",
  "SUCCEEDED",
  "BLOCKED",
] as const;
const JOB_EVENT_TYPES = new Set([
  "job.enqueued",
  "job.claimed",
  "job.reclaimed",
  "job.heartbeat",
  "job.retry_scheduled",
  "job.succeeded",
  "job.blocked",
  "job.cancelling",
  "job.cancelled",
]);
const VERIFICATION_STATUSES = new Set(["UNAVAILABLE", "PENDING", "VERIFIED", "BLOCKED"]);

export function decodeClientStateRequest(value: unknown): ClientStateRequest {
  const object = objectValue(value, "state request");
  exactKeys(
    object,
    [
      "afterCursor",
      "capabilityId",
      "limit",
      "missionId",
      "protocol",
      "requestId",
      "requestedAt",
      "sessionId",
    ],
    "state request",
  );
  return Object.freeze({
    afterCursor: safeInteger(object.afterCursor, "afterCursor", 0),
    capabilityId: identifier(object.capabilityId, "capabilityId"),
    limit: safeInteger(object.limit, "limit", 1, 99),
    missionId: identifier(object.missionId, "missionId"),
    protocol: protocolVersion(object.protocol),
    requestId: identifier(object.requestId, "requestId"),
    requestedAt: canonicalTimestamp(object.requestedAt, "requestedAt"),
    sessionId: identifier(object.sessionId, "sessionId"),
  });
}

export function decodeClientCommandRequest(value: unknown): ClientCommandRequest {
  const object = objectValue(value, "command request");
  exactKeys(
    object,
    [
      "capabilityId",
      "command",
      "expectedVersion",
      "idempotencyKey",
      "issuedAt",
      "missionId",
      "protocol",
      "requestId",
      "sessionId",
    ],
    "command request",
  );
  const command = text(object.command, "command") as ClientCommandName;
  if (!COMMANDS.has(command)) malformed("command is unsupported.");
  return Object.freeze({
    capabilityId: identifier(object.capabilityId, "capabilityId"),
    command,
    expectedVersion: safeInteger(object.expectedVersion, "expectedVersion", 1),
    idempotencyKey: identifier(object.idempotencyKey, "idempotencyKey", 180),
    issuedAt: canonicalTimestamp(object.issuedAt, "issuedAt"),
    missionId: identifier(object.missionId, "missionId"),
    protocol: protocolVersion(object.protocol),
    requestId: identifier(object.requestId, "requestId"),
    sessionId: identifier(object.sessionId, "sessionId"),
  });
}

export function normalizeCapabilityGrant(value: ClientCapabilityGrant): ClientCapabilityGrant {
  const object = objectValue(value, "capability grant");
  exactKeys(
    object,
    ["canRead", "commands", "expiresAt", "id", "missionId", "sessionId"],
    "capability grant",
  );
  if (typeof object.canRead !== "boolean") malformed("capability canRead must be boolean.");
  if (!Array.isArray(object.commands) || object.commands.length > COMMANDS.size) {
    malformed("capability commands are malformed.");
  }
  const commands = object.commands.map((entry) => {
    const command = text(entry, "capability command") as ClientCommandName;
    if (!COMMANDS.has(command)) malformed("capability command is unsupported.");
    return command;
  });
  if (new Set(commands).size !== commands.length)
    malformed("capability commands contain duplicates.");
  return Object.freeze({
    canRead: object.canRead,
    commands: Object.freeze([...commands].sort()),
    expiresAt: canonicalTimestamp(object.expiresAt, "capability expiresAt"),
    id: identifier(object.id, "capability id"),
    missionId: identifier(object.missionId, "capability missionId"),
    sessionId: identifier(object.sessionId, "capability sessionId"),
  });
}

export function buildClientProjection(
  snapshot: MissionSnapshot,
  jobs: Readonly<Record<string, number>>,
  verification: ClientVerificationSummary = { evidenceRefs: [], status: "UNAVAILABLE" },
  checkpointVersion: number | null = null,
): ClientMissionProjection {
  const normalizedJobs = normalizeJobCounts(jobs);
  const normalizedVerification = normalizeVerification(verification);
  const tasks = snapshot.tasks.map((task) => {
    const status = snapshot.taskStatuses[task.id];
    if (status === undefined || !TASK_STATUSES.has(status))
      malformed("mission task status is invalid.");
    return Object.freeze({
      dependsOn: Object.freeze([...task.dependsOn]),
      id: identifier(task.id, "task id"),
      priority: safeInteger(task.priority, "task priority", 0),
      status,
      title: boundedText(task.title, "task title", 4_096),
    });
  });
  if (!MISSION_STATES.has(snapshot.state)) malformed("mission state is invalid.");
  if (snapshot.resumeState !== null && !MISSION_STATES.has(snapshot.resumeState)) {
    malformed("mission resume state is invalid.");
  }
  if (!FOCUS.has(snapshot.focus)) malformed("mission focus is invalid.");
  return Object.freeze({
    budgetLimits: normalizeCounters(snapshot.budgetLimits, "budget limits"),
    budgetUsage: normalizeCounters(snapshot.budgetUsage, "budget usage"),
    checkpointVersion:
      checkpointVersion === null ? null : safeInteger(checkpointVersion, "checkpoint version", 1),
    focus: snapshot.focus,
    jobs: normalizedJobs,
    missionId: identifier(snapshot.id, "mission id"),
    objective: boundedText(snapshot.objective, "mission objective", 20_000),
    resumeState: snapshot.resumeState,
    state: snapshot.state,
    tasks: Object.freeze(tasks),
    verification: normalizedVerification,
    version: safeInteger(snapshot.version, "mission version", 1),
  });
}

export function normalizeLifecycleEvent(value: JobLifecycleEvent): ClientLifecycleEvent {
  const object = objectValue(value, "lifecycle event");
  exactKeys(
    object,
    [
      "cursor",
      "eventHash",
      "generation",
      "jobId",
      "missionId",
      "occurredAt",
      "reasonCode",
      "status",
      "type",
    ],
    "lifecycle event",
  );
  const type = text(object.type, "lifecycle type");
  const status = text(object.status, "lifecycle status");
  if (!JOB_EVENT_TYPES.has(type)) malformed("lifecycle type is unsupported.");
  if (!JOB_STATUSES.includes(status as (typeof JOB_STATUSES)[number])) {
    malformed("lifecycle status is unsupported.");
  }
  return Object.freeze({
    cursor: safeInteger(object.cursor, "lifecycle cursor", 1),
    eventHash: sha256(object.eventHash, "lifecycle eventHash"),
    generation: safeInteger(object.generation, "lifecycle generation", 0),
    jobId: identifier(object.jobId, "lifecycle jobId"),
    missionId: identifier(object.missionId, "lifecycle missionId"),
    occurredAt: canonicalTimestamp(object.occurredAt, "lifecycle occurredAt"),
    reasonCode:
      object.reasonCode === null
        ? null
        : identifier(object.reasonCode, "lifecycle reasonCode", 200),
    status: status as ClientLifecycleEvent["status"],
    type: type as ClientLifecycleEvent["type"],
  });
}

export function decodeClientStateResponse(value: unknown): ClientStateResponse {
  const object = objectValue(value, "state response");
  exactKeys(
    object,
    [
      "emittedAt",
      "events",
      "fromCursor",
      "hasMore",
      "missionId",
      "nextCursor",
      "projection",
      "protocol",
      "requestId",
      "sessionId",
    ],
    "state response",
  );
  if (typeof object.hasMore !== "boolean") malformed("state response hasMore must be boolean.");
  if (!Array.isArray(object.events) || object.events.length > 99) {
    malformed("state response events are malformed.");
  }
  const missionId = identifier(object.missionId, "response missionId");
  const fromCursor = safeInteger(object.fromCursor, "fromCursor", 0);
  const events = object.events.map((entry) => normalizeLifecycleEvent(entry as JobLifecycleEvent));
  let previous = fromCursor;
  for (const event of events) {
    if (event.missionId !== missionId || event.cursor <= previous) {
      malformed("state response lifecycle ordering/scope is invalid.");
    }
    previous = event.cursor;
  }
  const nextCursor = safeInteger(object.nextCursor, "nextCursor", 0);
  if (nextCursor !== (events.at(-1)?.cursor ?? fromCursor)) {
    malformed("state response nextCursor does not match its event page.");
  }
  const projection = decodeProjection(object.projection);
  if (projection.missionId !== missionId) malformed("projection mission scope is inconsistent.");
  return Object.freeze({
    emittedAt: canonicalTimestamp(object.emittedAt, "emittedAt"),
    events: Object.freeze(events),
    fromCursor,
    hasMore: object.hasMore,
    missionId,
    nextCursor,
    projection,
    protocol: protocolVersion(object.protocol),
    requestId: identifier(object.requestId, "response requestId"),
    sessionId: identifier(object.sessionId, "response sessionId"),
  });
}

function decodeProjection(value: unknown): ClientMissionProjection {
  const object = objectValue(value, "mission projection");
  exactKeys(
    object,
    [
      "budgetLimits",
      "budgetUsage",
      "checkpointVersion",
      "focus",
      "jobs",
      "missionId",
      "objective",
      "resumeState",
      "state",
      "tasks",
      "verification",
      "version",
    ],
    "mission projection",
  );
  const state = text(object.state, "projection state");
  if (!MISSION_STATES.has(state)) malformed("projection state is unsupported.");
  const focus = text(object.focus, "projection focus");
  if (!FOCUS.has(focus)) malformed("projection focus is unsupported.");
  if (!Array.isArray(object.tasks) || object.tasks.length > 1_024) {
    malformed("projection tasks are malformed.");
  }
  const tasks = object.tasks.map((entry) => {
    const task = objectValue(entry, "projection task");
    exactKeys(task, ["dependsOn", "id", "priority", "status", "title"], "projection task");
    if (!Array.isArray(task.dependsOn) || task.dependsOn.length > 1_024) {
      malformed("projection task dependencies are malformed.");
    }
    const status = text(task.status, "projection task status");
    if (!TASK_STATUSES.has(status)) malformed("projection task status is unsupported.");
    return Object.freeze({
      dependsOn: Object.freeze(task.dependsOn.map((item) => identifier(item, "dependency id"))),
      id: identifier(task.id, "projection task id"),
      priority: safeInteger(task.priority, "projection task priority", 0),
      status: status as ClientMissionProjection["tasks"][number]["status"],
      title: boundedText(task.title, "projection task title", 4_096),
    });
  });
  const resumeState = object.resumeState;
  if (
    resumeState !== null &&
    (typeof resumeState !== "string" || !MISSION_STATES.has(resumeState))
  ) {
    malformed("projection resumeState is unsupported.");
  }
  return Object.freeze({
    budgetLimits: normalizeCounters(object.budgetLimits, "projection budget limits"),
    budgetUsage: normalizeCounters(object.budgetUsage, "projection budget usage"),
    checkpointVersion:
      object.checkpointVersion === null
        ? null
        : safeInteger(object.checkpointVersion, "projection checkpoint version", 1),
    focus: focus as ClientMissionProjection["focus"],
    jobs: normalizeJobCounts(objectValue(object.jobs, "projection jobs")),
    missionId: identifier(object.missionId, "projection missionId"),
    objective: boundedText(object.objective, "projection objective", 20_000),
    resumeState: resumeState as ClientMissionProjection["resumeState"],
    state: state as ClientMissionProjection["state"],
    tasks: Object.freeze(tasks),
    verification: normalizeVerification(object.verification as ClientVerificationSummary),
    version: safeInteger(object.version, "projection version", 1),
  });
}

function normalizeJobCounts(value: Readonly<Record<string, unknown>>): ClientJobCounts {
  exactKeys(value as Record<string, unknown>, [...JOB_STATUSES], "job counts");
  const result = {} as Record<(typeof JOB_STATUSES)[number], number>;
  for (const status of JOB_STATUSES) {
    result[status] = safeInteger(value[status], `job count ${status}`, 0);
  }
  return Object.freeze(result);
}

function normalizeVerification(value: ClientVerificationSummary): ClientVerificationSummary {
  const object = objectValue(value, "verification summary");
  exactKeys(object, ["evidenceRefs", "status"], "verification summary");
  const status = text(object.status, "verification status");
  if (!VERIFICATION_STATUSES.has(status)) malformed("verification status is unsupported.");
  if (!Array.isArray(object.evidenceRefs) || object.evidenceRefs.length > 256) {
    malformed("verification evidence refs are malformed.");
  }
  const evidenceRefs = object.evidenceRefs.map((entry) => identifier(entry, "evidence ref", 500));
  if (new Set(evidenceRefs).size !== evidenceRefs.length) {
    malformed("verification evidence refs contain duplicates.");
  }
  return Object.freeze({
    evidenceRefs: Object.freeze(evidenceRefs),
    status: status as ClientVerificationSummary["status"],
  });
}

function normalizeCounters(value: unknown, label: string) {
  const object = objectValue(value, label);
  exactKeys(object, ["attempts", "costMicros", "inputTokens", "outputTokens", "toolCalls"], label);
  return Object.freeze({
    attempts: safeInteger(object.attempts, `${label}.attempts`, 0),
    costMicros: safeInteger(object.costMicros, `${label}.costMicros`, 0),
    inputTokens: safeInteger(object.inputTokens, `${label}.inputTokens`, 0),
    outputTokens: safeInteger(object.outputTokens, `${label}.outputTokens`, 0),
    toolCalls: safeInteger(object.toolCalls, `${label}.toolCalls`, 0),
  });
}

function protocolVersion(value: unknown): ClientProtocolVersion {
  const object = objectValue(value, "protocol version");
  exactKeys(object, ["major", "minor"], "protocol version");
  const major = safeInteger(object.major, "protocol major", 0, 10_000);
  const minor = safeInteger(object.minor, "protocol minor", 0, 10_000);
  if (major !== CLIENT_PROTOCOL_VERSION.major || minor > CLIENT_PROTOCOL_VERSION.minor) {
    throw new ClientProtocolError(
      "UNSUPPORTED_VERSION",
      `Unsupported client protocol ${major}.${minor}.`,
    );
  }
  return Object.freeze({ major, minor });
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    malformed(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(object: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  if (Object.keys(object).length !== expected.size)
    malformed(`${label} has an unexpected field count.`);
  for (const key of Object.keys(object)) {
    if (!expected.has(key)) malformed(`${label} contains unknown field ${key}.`);
  }
  for (const key of expected) {
    if (!(key in object)) malformed(`${label} is missing field ${key}.`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") malformed(`${label} must be text.`);
  return value;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  const result = text(value, label);
  if (result.trim() === "" || result.length > maximum || result.includes("\u0000")) {
    malformed(`${label} is empty or exceeds its bound.`);
  }
  return result;
}

function identifier(value: unknown, label: string, maximum = 200): string {
  return boundedText(value, label, maximum);
}

function canonicalTimestamp(value: unknown, label: string): string {
  const result = text(value, label);
  const parsed = Date.parse(result);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== result) {
    malformed(`${label} must be a canonical UTC timestamp.`);
  }
  return result;
}

function safeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    malformed(`${label} must be a bounded safe integer.`);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[a-f0-9]{64}$/u.test(result)) malformed(`${label} must be a lowercase SHA-256 hash.`);
  return result;
}

function malformed(message: string): never {
  throw new ClientProtocolError("MALFORMED", message);
}
