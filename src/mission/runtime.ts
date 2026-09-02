import type { EventStore, StoredEvent } from "../events/store.js";

export type MissionState =
  | "CREATED"
  | "UNDERSTANDING"
  | "RETRIEVING"
  | "PLANNING"
  | "RISK_CHECK"
  | "EXECUTING"
  | "OBSERVING"
  | "VERIFYING"
  | "DIAGNOSING"
  | "REPAIRING"
  | "CHECKPOINTING"
  | "FINAL_AUDIT"
  | "PAUSING"
  | "PAUSED"
  | "RESUMING"
  | "CANCELLING"
  | "COMPLETED"
  | "CANCELLED"
  | "BLOCKED"
  | "FAILED";

export type FocusClass = "routine" | "standard" | "complex" | "critical";
export type TaskStatus = "PENDING" | "RUNNING" | "VERIFIED" | "FAILED" | "CANCELLED";

export interface MissionTaskInput {
  readonly id: string;
  readonly title: string;
  readonly dependsOn?: readonly string[];
  readonly definitionOfDone: readonly string[];
  readonly priority?: number;
}

export interface MissionTask {
  readonly id: string;
  readonly title: string;
  readonly dependsOn: readonly string[];
  readonly definitionOfDone: readonly string[];
  readonly priority: number;
}

export interface BudgetCounters {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number;
  readonly toolCalls: number;
  readonly attempts: number;
}

export interface MissionCreateInput {
  readonly id: string;
  readonly objective: string;
  readonly focus: FocusClass;
  readonly tasks: readonly MissionTaskInput[];
  readonly budgetLimits: BudgetCounters;
}

export interface MissionSnapshot {
  readonly id: string;
  readonly objective: string;
  readonly focus: FocusClass;
  readonly state: MissionState;
  readonly resumeState: MissionState | null;
  readonly version: number;
  readonly tasks: readonly MissionTask[];
  readonly taskStatuses: Readonly<Record<string, TaskStatus>>;
  readonly budgetLimits: BudgetCounters;
  readonly budgetUsage: BudgetCounters;
  readonly failureCounts: Readonly<Record<string, number>>;
}

export type MissionEventData =
  | { readonly type: "mission.created"; readonly input: MissionCreateInput }
  | {
      readonly type: "mission.transitioned";
      readonly from: MissionState;
      readonly to: MissionState;
    }
  | { readonly type: "task.status_changed"; readonly taskId: string; readonly status: TaskStatus }
  | { readonly type: "budget.debited"; readonly delta: BudgetCounters }
  | { readonly type: "failure.recorded"; readonly signature: string };

const ZERO_COUNTERS: BudgetCounters = Object.freeze({
  attempts: 0,
  costMicros: 0,
  inputTokens: 0,
  outputTokens: 0,
  toolCalls: 0,
});

const NORMAL_TRANSITIONS: Readonly<Record<MissionState, readonly MissionState[]>> = {
  CREATED: ["UNDERSTANDING"],
  UNDERSTANDING: ["RETRIEVING"],
  RETRIEVING: ["PLANNING"],
  PLANNING: ["RISK_CHECK"],
  RISK_CHECK: ["EXECUTING"],
  EXECUTING: ["OBSERVING"],
  OBSERVING: ["VERIFYING"],
  VERIFYING: ["CHECKPOINTING", "DIAGNOSING"],
  DIAGNOSING: ["REPAIRING"],
  REPAIRING: ["VERIFYING"],
  CHECKPOINTING: ["FINAL_AUDIT"],
  FINAL_AUDIT: ["COMPLETED"],
  PAUSING: ["PAUSED"],
  PAUSED: ["RESUMING"],
  RESUMING: [],
  CANCELLING: ["CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  BLOCKED: [],
  FAILED: [],
};

const TERMINAL_STATES = new Set<MissionState>(["COMPLETED", "CANCELLED", "BLOCKED", "FAILED"]);
const INTERRUPTIBLE_STATES = new Set<MissionState>([
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
]);

export class MissionDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionDomainError";
  }
}

export class BudgetExceededError extends MissionDomainError {
  readonly dimension: keyof BudgetCounters;

  constructor(dimension: keyof BudgetCounters) {
    super(`Mission budget exceeded for ${dimension}.`);
    this.name = "BudgetExceededError";
    this.dimension = dimension;
  }
}

export function validateTaskGraph(inputs: readonly MissionTaskInput[]): readonly MissionTask[] {
  const tasks = inputs.map(normalizeTask);
  const byId = new Map<string, MissionTask>();
  for (const task of tasks) {
    if (byId.has(task.id)) throw new MissionDomainError(`Duplicate task id: ${task.id}.`);
    byId.set(task.id, task);
  }

  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) {
        throw new MissionDomainError(`Task ${task.id} cannot depend on itself.`);
      }
      if (!byId.has(dependency)) {
        throw new MissionDomainError(`Task ${task.id} depends on missing task ${dependency}.`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskId: string): void => {
    if (visiting.has(taskId)) throw new MissionDomainError("Task graph contains a cycle.");
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    const task = byId.get(taskId);
    if (task === undefined) throw new MissionDomainError(`Unknown task ${taskId}.`);
    for (const dependency of task.dependsOn) visit(dependency);
    visiting.delete(taskId);
    visited.add(taskId);
  };
  for (const task of tasks) visit(task.id);
  return Object.freeze(tasks.map((task) => Object.freeze(task)));
}

export function runnableTasks(snapshot: MissionSnapshot): readonly MissionTask[] {
  return snapshot.tasks
    .filter(
      (task) =>
        snapshot.taskStatuses[task.id] === "PENDING" &&
        task.dependsOn.every((dependency) => snapshot.taskStatuses[dependency] === "VERIFIED"),
    )
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
}

export function transitionEvent(snapshot: MissionSnapshot, to: MissionState): MissionEventData {
  assertTransition(snapshot, to);
  return { from: snapshot.state, to, type: "mission.transitioned" };
}

export function taskStatusEvent(
  snapshot: MissionSnapshot,
  taskId: string,
  status: TaskStatus,
): MissionEventData {
  assertMutableMission(snapshot);
  const current = snapshot.taskStatuses[taskId];
  if (current === undefined) throw new MissionDomainError(`Unknown task ${taskId}.`);
  const allowed: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
    PENDING: ["RUNNING", "CANCELLED"],
    RUNNING: ["VERIFIED", "FAILED", "CANCELLED"],
    VERIFIED: [],
    FAILED: ["PENDING", "CANCELLED"],
    CANCELLED: [],
  };
  if (!allowed[current].includes(status)) {
    throw new MissionDomainError(`Task transition ${current} -> ${status} is not allowed.`);
  }
  return { status, taskId, type: "task.status_changed" };
}

export function budgetDebitEvent(
  snapshot: MissionSnapshot,
  delta: BudgetCounters,
): MissionEventData {
  assertMutableMission(snapshot);
  assertCounters(delta, "budget debit");
  for (const dimension of counterKeys()) {
    const next = snapshot.budgetUsage[dimension] + delta[dimension];
    if (!Number.isSafeInteger(next) || next > snapshot.budgetLimits[dimension]) {
      throw new BudgetExceededError(dimension);
    }
  }
  return { delta: { ...delta }, type: "budget.debited" };
}

export function canRetry(
  snapshot: MissionSnapshot,
  signature: string,
  maxEquivalentFailures: number,
): boolean {
  assertFailurePolicy(signature, maxEquivalentFailures);
  return (
    !TERMINAL_STATES.has(snapshot.state) &&
    (snapshot.failureCounts[signature] ?? 0) < maxEquivalentFailures
  );
}

export function projectMission(events: readonly StoredEvent<MissionEventData>[]): MissionSnapshot {
  if (events.length === 0)
    throw new MissionDomainError("Cannot project an empty mission event stream.");
  let snapshot: MissionSnapshot | undefined;
  let missionId: string | undefined;
  let expectedSequence = 1;

  for (const event of events) {
    if (event.sequence !== expectedSequence || event.aggregateVersion !== expectedSequence) {
      throw new MissionDomainError("Mission event stream is not contiguous.");
    }
    missionId ??= event.missionId;
    if (event.missionId !== missionId)
      throw new MissionDomainError("Mission event stream mixes identities.");

    if (snapshot === undefined) {
      if (event.data.type !== "mission.created") {
        throw new MissionDomainError("The first mission event must be mission.created.");
      }
      if (event.data.input.id !== event.missionId) {
        throw new MissionDomainError("mission.created identity does not match its event stream.");
      }
      snapshot = initialSnapshot(event.data.input, event.aggregateVersion);
    } else {
      snapshot = applyEvent(snapshot, event.data, event.aggregateVersion);
    }
    expectedSequence += 1;
  }
  if (snapshot === undefined) throw new MissionDomainError("Mission projection failed.");
  return snapshot;
}

export class MissionRuntime {
  readonly #store: EventStore<MissionEventData>;
  readonly #clock: () => string;

  constructor(
    store: EventStore<MissionEventData>,
    clock: () => string = () => new Date().toISOString(),
  ) {
    this.#store = store;
    this.#clock = clock;
  }

  async create(input: MissionCreateInput, idempotencyKey: string): Promise<MissionSnapshot> {
    initialSnapshot(input, 0);
    await this.#store.append(input.id, 0, idempotencyKey, [
      {
        data: { input: structuredClone(input), type: "mission.created" },
        occurredAt: this.#clock(),
      },
    ]);
    return this.load(input.id);
  }

  async load(missionId: string): Promise<MissionSnapshot> {
    return projectMission(await this.#store.load(missionId));
  }

  async transition(
    missionId: string,
    expectedVersion: number,
    to: MissionState,
    idempotencyKey: string,
  ): Promise<MissionSnapshot> {
    const snapshot = await this.load(missionId);
    assertExpectedVersion(snapshot, expectedVersion);
    const data = transitionEvent(snapshot, to);
    await this.#store.append(missionId, expectedVersion, idempotencyKey, [
      { data, occurredAt: this.#clock() },
    ]);
    return this.load(missionId);
  }

  async setTaskStatus(
    missionId: string,
    expectedVersion: number,
    taskId: string,
    status: TaskStatus,
    idempotencyKey: string,
  ): Promise<MissionSnapshot> {
    const snapshot = await this.load(missionId);
    assertExpectedVersion(snapshot, expectedVersion);
    const data = taskStatusEvent(snapshot, taskId, status);
    await this.#store.append(missionId, expectedVersion, idempotencyKey, [
      { data, occurredAt: this.#clock() },
    ]);
    return this.load(missionId);
  }

  async debitBudget(
    missionId: string,
    expectedVersion: number,
    delta: BudgetCounters,
    idempotencyKey: string,
  ): Promise<MissionSnapshot> {
    const snapshot = await this.load(missionId);
    assertExpectedVersion(snapshot, expectedVersion);
    const data = budgetDebitEvent(snapshot, delta);
    await this.#store.append(missionId, expectedVersion, idempotencyKey, [
      { data, occurredAt: this.#clock() },
    ]);
    return this.load(missionId);
  }

  async recordFailure(
    missionId: string,
    expectedVersion: number,
    signature: string,
    maxEquivalentFailures: number,
    idempotencyKey: string,
  ): Promise<MissionSnapshot> {
    const snapshot = await this.load(missionId);
    assertExpectedVersion(snapshot, expectedVersion);
    assertFailurePolicy(signature, maxEquivalentFailures);
    if (!INTERRUPTIBLE_STATES.has(snapshot.state)) {
      throw new MissionDomainError(
        "Failures may only be recorded while a mission is actively executing.",
      );
    }

    const nextCount = (snapshot.failureCounts[signature] ?? 0) + 1;
    const items: Array<{ data: MissionEventData; occurredAt: string }> = [
      { data: { signature, type: "failure.recorded" }, occurredAt: this.#clock() },
    ];
    if (nextCount >= maxEquivalentFailures) {
      items.push({ data: transitionEvent(snapshot, "FAILED"), occurredAt: this.#clock() });
    }
    await this.#store.append(missionId, expectedVersion, idempotencyKey, items);
    return this.load(missionId);
  }
}

function initialSnapshot(input: MissionCreateInput, version: number): MissionSnapshot {
  assertNonEmpty(input.id, "mission id");
  assertNonEmpty(input.objective, "mission objective");
  assertCounters(input.budgetLimits, "budget limits");
  const tasks = validateTaskGraph(input.tasks);
  const taskStatuses: Record<string, TaskStatus> = {};
  for (const task of tasks) taskStatuses[task.id] = "PENDING";
  return {
    budgetLimits: { ...input.budgetLimits },
    budgetUsage: { ...ZERO_COUNTERS },
    failureCounts: {},
    focus: input.focus,
    id: input.id,
    objective: input.objective,
    resumeState: null,
    state: "CREATED",
    tasks,
    taskStatuses,
    version,
  };
}

function applyEvent(
  snapshot: MissionSnapshot,
  data: MissionEventData,
  aggregateVersion: number,
): MissionSnapshot {
  if (data.type === "mission.created")
    throw new MissionDomainError("mission.created may only occur once.");
  if (data.type === "mission.transitioned") {
    if (data.from !== snapshot.state)
      throw new MissionDomainError("Transition event source state is stale.");
    assertTransition(snapshot, data.to);
    return {
      ...snapshot,
      resumeState: nextResumeState(snapshot, data.to),
      state: data.to,
      version: aggregateVersion,
    };
  }
  if (data.type === "task.status_changed") {
    taskStatusEvent(snapshot, data.taskId, data.status);
    return {
      ...snapshot,
      taskStatuses: { ...snapshot.taskStatuses, [data.taskId]: data.status },
      version: aggregateVersion,
    };
  }
  if (data.type === "budget.debited") {
    budgetDebitEvent(snapshot, data.delta);
    return {
      ...snapshot,
      budgetUsage: addCounters(snapshot.budgetUsage, data.delta),
      version: aggregateVersion,
    };
  }
  const signature = data.signature;
  assertNonEmpty(signature, "failure signature");
  return {
    ...snapshot,
    failureCounts: {
      ...snapshot.failureCounts,
      [signature]: (snapshot.failureCounts[signature] ?? 0) + 1,
    },
    version: aggregateVersion,
  };
}

function assertTransition(snapshot: MissionSnapshot, to: MissionState): void {
  const from = snapshot.state;
  if (TERMINAL_STATES.has(from)) throw new MissionDomainError(`Mission ${from} is terminal.`);
  if (from === "RESUMING") {
    if (snapshot.resumeState === null || to !== snapshot.resumeState) {
      throw new MissionDomainError("RESUMING must return to the captured pre-pause state.");
    }
    return;
  }
  if (
    INTERRUPTIBLE_STATES.has(from) &&
    ["PAUSING", "CANCELLING", "BLOCKED", "FAILED"].includes(to)
  ) {
    return;
  }
  if ((from === "PAUSING" || from === "PAUSED") && to === "CANCELLING") return;
  if (!NORMAL_TRANSITIONS[from].includes(to)) {
    throw new MissionDomainError(`Mission transition ${from} -> ${to} is not allowed.`);
  }
}

function nextResumeState(snapshot: MissionSnapshot, to: MissionState): MissionState | null {
  if (to === "PAUSING") return snapshot.state;
  if (snapshot.state === "RESUMING" && to === snapshot.resumeState) return null;
  if (["CANCELLED", "COMPLETED", "BLOCKED", "FAILED"].includes(to)) return null;
  return snapshot.resumeState;
}

function normalizeTask(input: MissionTaskInput): MissionTask {
  assertNonEmpty(input.id, "task id");
  assertNonEmpty(input.title, `task ${input.id} title`);
  if (
    input.definitionOfDone.length === 0 ||
    input.definitionOfDone.some((item) => item.trim() === "")
  ) {
    throw new MissionDomainError(`Task ${input.id} requires non-empty definitions of done.`);
  }
  const dependencies = [...(input.dependsOn ?? [])];
  if (new Set(dependencies).size !== dependencies.length) {
    throw new MissionDomainError(`Task ${input.id} contains duplicate dependencies.`);
  }
  const priority = input.priority ?? 0;
  if (!Number.isSafeInteger(priority))
    throw new MissionDomainError(`Task ${input.id} priority must be a safe integer.`);
  return {
    definitionOfDone: [...input.definitionOfDone],
    dependsOn: dependencies,
    id: input.id,
    priority,
    title: input.title,
  };
}

function assertCounters(value: BudgetCounters, name: string): void {
  for (const key of counterKeys()) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      throw new MissionDomainError(`${name} ${key} must be a non-negative safe integer.`);
    }
  }
}

function addCounters(left: BudgetCounters, right: BudgetCounters): BudgetCounters {
  return {
    attempts: left.attempts + right.attempts,
    costMicros: left.costMicros + right.costMicros,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    toolCalls: left.toolCalls + right.toolCalls,
  };
}

function counterKeys(): readonly (keyof BudgetCounters)[] {
  return ["inputTokens", "outputTokens", "costMicros", "toolCalls", "attempts"];
}

function assertFailurePolicy(signature: string, maxEquivalentFailures: number): void {
  assertNonEmpty(signature, "failure signature");
  if (!Number.isSafeInteger(maxEquivalentFailures) || maxEquivalentFailures < 1) {
    throw new MissionDomainError("maxEquivalentFailures must be a positive safe integer.");
  }
}

function assertExpectedVersion(snapshot: MissionSnapshot, expectedVersion: number): void {
  if (snapshot.version !== expectedVersion) {
    throw new MissionDomainError(
      `Mission version mismatch: expected ${expectedVersion}, current ${snapshot.version}.`,
    );
  }
}

function assertMutableMission(snapshot: MissionSnapshot): void {
  if (TERMINAL_STATES.has(snapshot.state)) {
    throw new MissionDomainError(`Mission ${snapshot.state} is terminal.`);
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim() === "") throw new MissionDomainError(`${name} must be non-empty.`);
}
