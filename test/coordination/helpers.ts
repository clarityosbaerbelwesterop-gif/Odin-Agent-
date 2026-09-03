import {
  type CoordinationTaskSpec,
  type OwnershipClaim,
  type SpecialistAssignment,
  type SpecialistCoordinatorOptions,
  type SpecialistProfile,
  type SpecialistProposal,
  SpecialistRegistry,
  type SpecialistWorker,
} from "../../src/coordination/index.js";
import type { MissionSnapshot, MissionTask, TaskStatus } from "../../src/mission/index.js";

export const NOW = "2026-09-03T12:00:00.000Z";
export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);

export class CallbackWorker implements SpecialistWorker {
  readonly #callback: (
    assignment: SpecialistAssignment,
    signal: AbortSignal,
  ) => Promise<SpecialistProposal>;

  constructor(
    callback: (
      assignment: SpecialistAssignment,
      signal: AbortSignal,
    ) => Promise<SpecialistProposal>,
  ) {
    this.#callback = callback;
  }

  execute(assignment: SpecialistAssignment, signal: AbortSignal): Promise<SpecialistProposal> {
    return this.#callback(assignment, signal);
  }
}

export function missionSnapshot(
  tasks: readonly MissionTask[],
  statuses: Readonly<Record<string, TaskStatus>> = Object.fromEntries(
    tasks.map((task) => [task.id, "PENDING"]),
  ),
  overrides: Partial<MissionSnapshot> = {},
): MissionSnapshot {
  return {
    budgetLimits: {
      attempts: 100,
      costMicros: 1_000_000,
      inputTokens: 100_000,
      outputTokens: 100_000,
      toolCalls: 100,
    },
    budgetUsage: { attempts: 0, costMicros: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0 },
    failureCounts: {},
    focus: "complex",
    id: "mission-m7",
    objective: "Coordinate bounded specialist work",
    resumeState: null,
    state: "EXECUTING",
    taskStatuses: statuses,
    tasks,
    version: 7,
    ...overrides,
  };
}

export function task(id: string, priority: number, dependsOn: readonly string[] = []): MissionTask {
  return {
    definitionOfDone: [`${id} is independently verified`],
    dependsOn,
    id,
    priority,
    title: `Execute ${id}`,
  };
}

export function taskSpec(
  taskId: string,
  ownership: readonly OwnershipClaim[] = [],
  overrides: Partial<CoordinationTaskSpec> = {},
): CoordinationTaskSpec {
  return {
    context: {
      missionId: "mission-m7",
      resultHash: HASH_A,
      selectedIds: [`context:${taskId}`],
      sourceFingerprint: HASH_B,
      taskId,
    },
    goal: `Produce a bounded result for ${taskId}.`,
    ownership,
    requiredCapabilities: ["typescript"],
    role: "implementer",
    taskId,
    ...overrides,
  };
}

export function profile(id: string, overrides: Partial<SpecialistProfile> = {}): SpecialistProfile {
  return {
    capabilities: ["typescript"],
    description: `Bounded specialist ${id}.`,
    id,
    maxConcurrency: 4,
    provenance: { contentHash: HASH_A, source: `builtin:${id}`, version: "1" },
    roles: ["implementer"],
    trustClass: "test_fixture",
    version: "1.0.0",
    ...overrides,
  };
}

export function registryWith(
  entries: readonly (readonly [SpecialistProfile, SpecialistWorker])[],
): SpecialistRegistry {
  const registry = new SpecialistRegistry();
  for (const [specialist, worker] of entries) registry.register(specialist, worker);
  return registry;
}

export function coordinatorOptions(
  overrides: Partial<SpecialistCoordinatorOptions> = {},
): SpecialistCoordinatorOptions {
  return {
    clock: () => NOW,
    evidenceAuthority: {
      attests: (assignment, evidence) =>
        evidence.id === `evidence:${assignment.taskId}` &&
        evidence.reference === `test:${assignment.taskId}` &&
        evidence.contentHash === HASH_A,
    },
    executionTimeoutMs: 200,
    leaseDurationMs: 60_000,
    maxActiveAssignments: 8,
    maxBatchSize: 8,
    ...overrides,
  };
}

export function successfulProposal(
  assignment: SpecialistAssignment,
  overrides: Partial<SpecialistProposal> = {},
): SpecialistProposal {
  return {
    artifacts: [],
    assignmentId: assignment.id,
    assumptions: [],
    completedAt: assignment.lease.issuedAt,
    evidence: [
      {
        contentHash: HASH_A,
        id: `evidence:${assignment.taskId}`,
        kind: "test_run",
        observedAt: assignment.lease.issuedAt,
        producerClass: "independent_tool",
        reference: `test:${assignment.taskId}`,
        status: "PASS",
      },
    ],
    filesChanged: [],
    missionId: assignment.missionId,
    outcome: "SUCCESS",
    remainingWork: [],
    risks: [],
    specialistId: assignment.lease.specialistId,
    specialistVersion: assignment.lease.specialistVersion,
    startedAt: assignment.lease.issuedAt,
    summary: `Completed ${assignment.taskId}.`,
    taskId: assignment.taskId,
    verificationStatus: "VERIFIED",
    ...overrides,
  };
}

export function successWorker(proposalOverrides: Partial<SpecialistProposal> = {}): CallbackWorker {
  return new CallbackWorker(async (assignment) =>
    successfulProposal(assignment, proposalOverrides),
  );
}
