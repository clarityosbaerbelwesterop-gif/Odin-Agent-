import { type MissionSnapshot, runnableTasks } from "../mission/index.js";
import {
  assertCanonicalTimestamp,
  assertIdentifier,
  assertSha256,
  assertText,
  assertToken,
  immutableClone,
  MAX_COLLECTION_ITEMS,
  MAX_SUMMARY_LENGTH,
  normalizeUniqueTokens,
  stableHash,
} from "./internal.js";
import { conflictingTaskIds, normalizeOwnershipClaims } from "./ownership.js";
import type { SpecialistRegistry } from "./registry.js";
import { executionFailureReconciliation, reconcileProposal } from "./result.js";
import type {
  ContextPackageReference,
  CoordinationBatchResult,
  CoordinationDeferral,
  CoordinationPlan,
  CoordinationTaskSpec,
  OwnershipLease,
  SpecialistAssignment,
  SpecialistCoordinatorOptions,
  SpecialistEvidenceAuthority,
  SpecialistProfile,
  TaskReconciliation,
} from "./types.js";

const MAX_PARALLELISM = 64;
const MAX_LEASE_DURATION_MS = 3_600_000;
const MAX_PLAN_RECORDS = 1_024;
const REJECT_UNATTESTED_EVIDENCE: SpecialistEvidenceAuthority = Object.freeze({
  attests: () => false,
});

type PlanState = "executing" | "released" | "reserved";

interface PlanRecord {
  readonly plan: CoordinationPlan;
  readonly controllers: Set<AbortController>;
  readonly expiresAtMs: number;
  state: PlanState;
}

export class CoordinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoordinationError";
  }
}

export class SpecialistCoordinator {
  readonly #registry: SpecialistRegistry;
  readonly #maxBatchSize: number;
  readonly #maxActiveAssignments: number;
  readonly #leaseDurationMs: number;
  readonly #executionTimeoutMs: number;
  readonly #evidenceAuthority: SpecialistEvidenceAuthority;
  readonly #maxPlanRecords: number;
  readonly #clock: () => string;
  readonly #plans = new Map<string, PlanRecord>();
  readonly #leases = new Map<string, OwnershipLease>();
  #planGeneration = 0;
  #leaseGeneration = 0;
  #lastClockMs: number | undefined;

  constructor(registry: SpecialistRegistry, options: SpecialistCoordinatorOptions) {
    this.#registry = registry;
    this.#maxBatchSize = boundedInteger(options.maxBatchSize, "maxBatchSize", MAX_PARALLELISM);
    this.#maxActiveAssignments = boundedInteger(
      options.maxActiveAssignments,
      "maxActiveAssignments",
      MAX_PARALLELISM,
    );
    this.#leaseDurationMs = boundedInteger(
      options.leaseDurationMs,
      "leaseDurationMs",
      MAX_LEASE_DURATION_MS,
    );
    this.#executionTimeoutMs = boundedInteger(
      options.executionTimeoutMs,
      "executionTimeoutMs",
      this.#leaseDurationMs,
    );
    this.#evidenceAuthority = options.evidenceAuthority ?? REJECT_UNATTESTED_EVIDENCE;
    if (typeof this.#evidenceAuthority.attests !== "function") {
      throw new TypeError("evidenceAuthority must implement attests().");
    }
    this.#maxPlanRecords = boundedInteger(
      options.maxPlanRecords ?? 256,
      "maxPlanRecords",
      MAX_PLAN_RECORDS,
    );
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  plan(snapshot: MissionSnapshot, taskSpecs: readonly CoordinationTaskSpec[]): CoordinationPlan {
    if (snapshot.state !== "EXECUTING") {
      throw new CoordinationError(
        "Specialist work may only be planned while a mission is EXECUTING.",
      );
    }
    assertIdentifier(snapshot.id, "mission.id");
    if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1) {
      throw new CoordinationError("Mission version must be a positive safe integer.");
    }
    const { timestamp: createdAt, milliseconds: nowMs } = this.#readClock();
    this.#expirePlans(nowMs);
    this.#prunePlanRecords();
    if (this.#planGeneration === Number.MAX_SAFE_INTEGER) {
      throw new CoordinationError("Coordination plan generation is exhausted.");
    }
    if (!Array.isArray(snapshot.tasks) || snapshot.tasks.length > MAX_COLLECTION_ITEMS) {
      throw new CoordinationError(
        `Mission task coordination is limited to ${MAX_COLLECTION_ITEMS} tasks.`,
      );
    }

    const specs = normalizeTaskSpecs(snapshot, taskSpecs);
    const runnableIds = new Set(runnableTasks(snapshot).map((task) => task.id));
    const pendingTasks = snapshot.tasks
      .filter((task) => snapshot.taskStatuses[task.id] === "PENDING")
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
    const maximumNewLeases = Math.min(this.#maxBatchSize, pendingTasks.length);
    if (this.#leaseGeneration > Number.MAX_SAFE_INTEGER - maximumNewLeases) {
      throw new CoordinationError("Specialist lease generation is exhausted.");
    }
    const assignments: SpecialistAssignment[] = [];
    const deferred: CoordinationDeferral[] = [];

    for (const task of pendingTasks) {
      if (!runnableIds.has(task.id)) {
        deferred.push(deferral(task.id, "dependency_blocked"));
        continue;
      }
      const spec = specs.get(task.id);
      if (spec === undefined) {
        deferred.push(deferral(task.id, "missing_spec"));
        continue;
      }
      const activeTaskLease = this.#activeTaskLease(snapshot.id, task.id);
      if (activeTaskLease !== undefined) {
        deferred.push(deferral(task.id, "task_already_leased", [activeTaskLease.taskId]));
        continue;
      }
      if (assignments.length >= this.#maxBatchSize) {
        deferred.push(deferral(task.id, "batch_limit"));
        continue;
      }
      if (this.#leases.size >= this.#maxActiveAssignments) {
        deferred.push(deferral(task.id, "runtime_capacity"));
        continue;
      }

      const matches = this.#registry.matching(spec.role, spec.requiredCapabilities);
      if (matches.length === 0) {
        deferred.push(deferral(task.id, "missing_specialist"));
        continue;
      }
      const specialist = matches.find(
        (profile) => this.#activeSpecialistCount(profile) < profile.maxConcurrency,
      );
      if (specialist === undefined) {
        deferred.push(deferral(task.id, "specialist_capacity"));
        continue;
      }

      const conflicts = conflictingTaskIds(spec.ownership, this.#activeLeasesSorted());
      if (conflicts.length > 0) {
        deferred.push(deferral(task.id, "ownership_conflict", conflicts));
        continue;
      }

      const assignment = this.#reserveAssignment(snapshot, task.title, spec, specialist, createdAt);
      assignments.push(assignment);
    }

    this.#planGeneration += 1;
    const base = {
      assignments,
      createdAt,
      deferred,
      generation: this.#planGeneration,
      missionId: snapshot.id,
      missionVersion: snapshot.version,
      schemaVersion: 1 as const,
    };
    const plan = immutableClone({ ...base, planHash: stableHash(base) });
    this.#plans.set(plan.planHash, {
      controllers: new Set(),
      expiresAtMs: nowMs + this.#leaseDurationMs,
      plan,
      state: "reserved",
    });
    return immutableClone(plan);
  }

  async execute(plan: CoordinationPlan): Promise<CoordinationBatchResult> {
    const { milliseconds: nowMs } = this.#readClock();
    this.#expirePlans(nowMs);
    const record = this.#plans.get(plan.planHash);
    if (record === undefined) throw new CoordinationError("Unknown or foreign coordination plan.");
    if (record.state !== "reserved") {
      throw new CoordinationError("Coordination plan was already released, executed, or replayed.");
    }
    try {
      this.#assertAuthenticPlan(plan, record, nowMs);
    } catch (error) {
      this.#releaseRecord(record);
      throw error;
    }

    record.state = "executing";
    try {
      const reconciliations = await Promise.all(
        record.plan.assignments.map((assignment) => this.#executeAssignment(assignment, record)),
      );
      if (record.state !== "executing") {
        throw new CoordinationError("Coordination plan was released during execution.");
      }
      const { timestamp: completedAt } = this.#readClock();
      return immutableClone(createBatchResult(record.plan, completedAt, reconciliations));
    } finally {
      this.#releaseRecord(record);
    }
  }

  releasePlan(planHash: string): boolean {
    assertSha256(planHash, "planHash");
    const record = this.#plans.get(planHash);
    if (record === undefined || record.state === "released") return false;
    this.#releaseRecord(record);
    return true;
  }

  activeLeases(): readonly OwnershipLease[] {
    const { milliseconds: nowMs } = this.#readClock();
    this.#expirePlans(nowMs);
    return immutableClone(this.#activeLeasesSorted());
  }

  #reserveAssignment(
    snapshot: MissionSnapshot,
    title: string,
    spec: CoordinationTaskSpec,
    specialist: SpecialistProfile,
    issuedAt: string,
  ): SpecialistAssignment {
    this.#leaseGeneration += 1;
    const generation = this.#leaseGeneration;
    const expiresAt = new Date(Date.parse(issuedAt) + this.#leaseDurationMs).toISOString();
    const leaseIdentity = {
      generation,
      issuedAt,
      missionId: snapshot.id,
      specialistId: specialist.id,
      specialistVersion: specialist.version,
      taskId: spec.taskId,
    };
    const lease: OwnershipLease = {
      claims: spec.ownership,
      expiresAt,
      ...leaseIdentity,
      id: `lease:${stableHash(leaseIdentity)}`,
    };
    const assignmentIdentity = {
      generation,
      leaseId: lease.id,
      missionId: snapshot.id,
      missionVersion: snapshot.version,
      specialistId: specialist.id,
      specialistVersion: specialist.version,
      taskId: spec.taskId,
    };
    const base = {
      context: spec.context,
      goal: spec.goal,
      id: `assignment:${stableHash(assignmentIdentity)}`,
      lease,
      missionId: snapshot.id,
      missionVersion: snapshot.version,
      requiredCapabilities: spec.requiredCapabilities,
      role: spec.role,
      taskId: spec.taskId,
      title,
    };
    const assignment = immutableClone({ ...base, assignmentHash: stableHash(base) });
    this.#leases.set(lease.id, assignment.lease);
    return assignment;
  }

  async #executeAssignment(
    assignment: SpecialistAssignment,
    record: PlanRecord,
  ): Promise<TaskReconciliation> {
    const controller = new AbortController();
    record.controllers.add(controller);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new WorkerTimeoutError());
      }, this.#executionTimeoutMs);
    });
    try {
      const worker = this.#registry.worker(
        assignment.lease.specialistId,
        assignment.lease.specialistVersion,
      );
      const proposal = await Promise.race([
        Promise.resolve().then(() => worker.execute(immutableClone(assignment), controller.signal)),
        timedOut,
      ]);
      const { milliseconds: receivedAtMs } = this.#readClock();
      return reconcileProposal(assignment, proposal, receivedAtMs, this.#evidenceAuthority);
    } catch (error) {
      return executionFailureReconciliation(
        assignment,
        error instanceof WorkerTimeoutError ? "worker_timeout" : "worker_failed",
      );
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      record.controllers.delete(controller);
    }
  }

  #assertAuthenticPlan(plan: CoordinationPlan, record: PlanRecord, nowMs: number): void {
    if (!isPlainObject(plan)) throw new CoordinationError("Coordination plan must be an object.");
    assertSha256(plan.planHash, "plan.planHash");
    const { planHash: suppliedHash, ...payload } = plan;
    if (
      stableHash(payload) !== suppliedHash ||
      stableHash(plan) !== stableHash(record.plan) ||
      plan.missionId !== record.plan.missionId ||
      plan.missionVersion !== record.plan.missionVersion
    ) {
      throw new CoordinationError("Coordination plan failed integrity validation.");
    }

    const assignmentIds = new Set<string>();
    const leaseIds = new Set<string>();
    for (const assignment of plan.assignments) {
      const { assignmentHash, ...assignmentPayload } = assignment;
      if (stableHash(assignmentPayload) !== assignmentHash) {
        throw new CoordinationError("Specialist assignment failed integrity validation.");
      }
      if (assignmentIds.has(assignment.id) || leaseIds.has(assignment.lease.id)) {
        throw new CoordinationError("Coordination plan contains duplicate assignments or leases.");
      }
      assignmentIds.add(assignment.id);
      leaseIds.add(assignment.lease.id);
      const active = this.#leases.get(assignment.lease.id);
      if (active === undefined || stableHash(active) !== stableHash(assignment.lease)) {
        throw new CoordinationError("Specialist assignment lease is missing or no longer active.");
      }
      const expiresMs = assertCanonicalTimestamp(assignment.lease.expiresAt, "lease.expiresAt");
      if (expiresMs <= nowMs)
        throw new CoordinationError("Specialist assignment lease has expired.");
      if (
        assignment.missionId !== plan.missionId ||
        assignment.missionVersion !== plan.missionVersion ||
        assignment.taskId !== assignment.lease.taskId ||
        assignment.missionId !== assignment.lease.missionId
      ) {
        throw new CoordinationError("Specialist assignment binding is invalid.");
      }
    }
  }

  #activeTaskLease(missionId: string, taskId: string): OwnershipLease | undefined {
    return this.#activeLeasesSorted().find(
      (lease) => lease.missionId === missionId && lease.taskId === taskId,
    );
  }

  #activeSpecialistCount(profile: SpecialistProfile): number {
    return this.#activeLeasesSorted().filter(
      (lease) => lease.specialistId === profile.id && lease.specialistVersion === profile.version,
    ).length;
  }

  #activeLeasesSorted(): OwnershipLease[] {
    return [...this.#leases.values()].sort(
      (left, right) => left.taskId.localeCompare(right.taskId) || left.id.localeCompare(right.id),
    );
  }

  #expirePlans(nowMs: number): void {
    for (const record of this.#plans.values()) {
      if (record.state !== "released" && record.expiresAtMs <= nowMs) {
        this.#releaseRecord(record);
      }
    }
  }

  #releaseRecord(record: PlanRecord): void {
    if (record.state === "released") return;
    for (const controller of record.controllers) controller.abort();
    record.controllers.clear();
    for (const assignment of record.plan.assignments) {
      const active = this.#leases.get(assignment.lease.id);
      if (active !== undefined && stableHash(active) === stableHash(assignment.lease)) {
        this.#leases.delete(assignment.lease.id);
      }
    }
    record.state = "released";
  }

  #prunePlanRecords(): void {
    if (this.#plans.size < this.#maxPlanRecords) return;
    for (const [hash, record] of this.#plans) {
      if (record.state === "released") this.#plans.delete(hash);
      if (this.#plans.size < this.#maxPlanRecords) return;
    }
    throw new CoordinationError("Coordination plan record capacity is exhausted.");
  }

  #readClock(): { readonly timestamp: string; readonly milliseconds: number } {
    const timestamp = this.#clock();
    const milliseconds = assertCanonicalTimestamp(timestamp, "coordination clock");
    if (this.#lastClockMs !== undefined && milliseconds < this.#lastClockMs) {
      throw new CoordinationError("Coordination clock cannot move backwards.");
    }
    this.#lastClockMs = milliseconds;
    return { milliseconds, timestamp };
  }
}

function normalizeTaskSpecs(
  snapshot: MissionSnapshot,
  taskSpecs: readonly CoordinationTaskSpec[],
): ReadonlyMap<string, CoordinationTaskSpec> {
  if (!Array.isArray(taskSpecs) || taskSpecs.length > MAX_COLLECTION_ITEMS) {
    throw new TypeError(`taskSpecs is limited to ${MAX_COLLECTION_ITEMS} entries.`);
  }
  const taskIds = new Set(snapshot.tasks.map((task) => task.id));
  if (taskIds.size !== snapshot.tasks.length) {
    throw new TypeError("Mission snapshot contains duplicate task IDs.");
  }
  for (const task of snapshot.tasks) {
    assertIdentifier(task.id, "mission.task.id");
    assertText(task.title, "mission.task.title", MAX_SUMMARY_LENGTH);
  }
  const specs = new Map<string, CoordinationTaskSpec>();
  for (const candidate of taskSpecs) {
    assertTaskSpecShape(candidate);
    assertIdentifier(candidate.taskId, "taskSpec.taskId");
    if (!taskIds.has(candidate.taskId)) {
      throw new TypeError(`Task specification references unknown task '${candidate.taskId}'.`);
    }
    if (specs.has(candidate.taskId)) {
      throw new TypeError(`Duplicate task specification '${candidate.taskId}'.`);
    }
    assertText(candidate.goal, "taskSpec.goal", MAX_SUMMARY_LENGTH);
    assertToken(candidate.role, "taskSpec.role");
    const requiredCapabilities = normalizeCapabilities(candidate.requiredCapabilities);
    const ownership = normalizeOwnershipClaims(candidate.ownership, "taskSpec.ownership");
    const context = normalizeContext(candidate.context, snapshot.id, candidate.taskId);
    specs.set(
      candidate.taskId,
      immutableClone({
        context,
        goal: candidate.goal,
        ownership,
        requiredCapabilities,
        role: candidate.role,
        taskId: candidate.taskId,
      }),
    );
  }
  return specs;
}

function normalizeCapabilities(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length > MAX_COLLECTION_ITEMS) {
    throw new TypeError(`requiredCapabilities is limited to ${MAX_COLLECTION_ITEMS} entries.`);
  }
  return values.length === 0 ? [] : normalizeUniqueTokens(values, "requiredCapabilities");
}

function normalizeContext(
  context: ContextPackageReference,
  missionId: string,
  taskId: string,
): ContextPackageReference {
  if (!isPlainObject(context)) throw new TypeError("taskSpec.context must be an object.");
  assertExactKeys(
    context,
    ["missionId", "resultHash", "selectedIds", "sourceFingerprint", "taskId"],
    "taskSpec.context",
  );
  if (context.missionId !== missionId || context.taskId !== taskId) {
    throw new TypeError("Context package is foreign to its mission or task.");
  }
  assertSha256(context.resultHash, "context.resultHash");
  assertSha256(context.sourceFingerprint, "context.sourceFingerprint");
  if (!Array.isArray(context.selectedIds) || context.selectedIds.length > MAX_COLLECTION_ITEMS) {
    throw new TypeError(`context.selectedIds is limited to ${MAX_COLLECTION_ITEMS} entries.`);
  }
  const selectedIds = context.selectedIds.map((id) => {
    assertIdentifier(id, "context.selectedIds");
    return id;
  });
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new TypeError("context.selectedIds must not contain duplicates.");
  }
  return { ...context, selectedIds: selectedIds.sort() };
}

function assertTaskSpecShape(value: CoordinationTaskSpec): void {
  if (!isPlainObject(value)) throw new TypeError("Task specification must be an object.");
  assertExactKeys(
    value,
    ["context", "goal", "ownership", "requiredCapabilities", "role", "taskId"],
    "taskSpec",
  );
}

function assertExactKeys(value: object, keys: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${name} contains missing or unsupported fields.`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deferral(
  taskId: string,
  reason: CoordinationDeferral["reason"],
  conflictsWithTaskIds: readonly string[] = [],
): CoordinationDeferral {
  return { conflictsWithTaskIds: [...conflictsWithTaskIds].sort(), reason, taskId };
}

function createBatchResult(
  plan: CoordinationPlan,
  completedAt: string,
  reconciliations: readonly TaskReconciliation[],
): CoordinationBatchResult {
  const base = {
    acceptedTaskIds: taskIdsForOutcome(reconciliations, "ACCEPTED"),
    blockedTaskIds: taskIdsForOutcome(reconciliations, "BLOCKED"),
    completedAt,
    missionId: plan.missionId,
    planHash: plan.planHash,
    reconciliations,
    retryTaskIds: taskIdsForOutcome(reconciliations, "RETRY_REQUIRED"),
    schemaVersion: 1 as const,
  };
  return { ...base, resultHash: stableHash(base) };
}

function taskIdsForOutcome(
  reconciliations: readonly TaskReconciliation[],
  outcome: TaskReconciliation["outcome"],
): readonly string[] {
  return reconciliations.filter((item) => item.outcome === outcome).map((item) => item.taskId);
}

function boundedInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return value;
}

class WorkerTimeoutError extends Error {}
