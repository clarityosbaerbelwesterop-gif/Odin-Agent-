import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ClientCapabilityGrant,
  ClientCommandRequest,
  ClientStateRequest,
} from "../../src/client/types.js";
import type { SqliteDurableStore } from "../../src/durable/store.js";
import type { JobEnqueueInput } from "../../src/durable/types.js";
import type { MissionCreateInput, MissionSnapshot } from "../../src/mission/runtime.js";
import { MissionRuntime } from "../../src/mission/runtime.js";

export const T0 = "2026-09-03T15:00:00.000Z";

export function plusMs(timestamp: string, milliseconds: number): string {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

export function missionInput(id = "mission-client"): MissionCreateInput {
  return {
    budgetLimits: {
      attempts: 50,
      costMicros: 1_000_000,
      inputTokens: 100_000,
      outputTokens: 100_000,
      toolCalls: 100,
    },
    focus: "complex",
    id,
    objective: "Expose a safe user-facing mission projection",
    tasks: [
      {
        definitionOfDone: ["protocol verified"],
        id: "task-protocol",
        priority: 10,
        title: "Verify protocol",
      },
      {
        definitionOfDone: ["reconnect verified"],
        dependsOn: ["task-protocol"],
        id: "task-reconnect",
        priority: 5,
        title: "Verify reconnect",
      },
    ],
  };
}

export async function executingMission(
  store: SqliteDurableStore,
  id = "mission-client",
): Promise<MissionSnapshot> {
  const runtime = new MissionRuntime(store, () => T0);
  let snapshot = await runtime.create(missionInput(id), `create-${id}`);
  for (const state of [
    "UNDERSTANDING",
    "RETRIEVING",
    "PLANNING",
    "RISK_CHECK",
    "EXECUTING",
  ] as const) {
    snapshot = await runtime.transition(snapshot.id, snapshot.version, state, `${id}-${state}`);
  }
  return snapshot;
}

export function capability(
  missionId = "mission-client",
  overrides: Partial<ClientCapabilityGrant> = {},
): ClientCapabilityGrant {
  return {
    canRead: true,
    commands: ["mission.pause", "mission.resume", "mission.cancel"],
    expiresAt: plusMs(T0, 60 * 60 * 1_000),
    id: "cap-client",
    missionId,
    sessionId: "session-client",
    ...overrides,
  };
}

export function stateRequest(
  missionId = "mission-client",
  overrides: Partial<ClientStateRequest> = {},
): ClientStateRequest {
  return {
    afterCursor: 0,
    capabilityId: "cap-client",
    limit: 20,
    missionId,
    protocol: { major: 1, minor: 0 },
    requestId: "request-state",
    requestedAt: T0,
    sessionId: "session-client",
    ...overrides,
  };
}

export function commandRequest(
  command: ClientCommandRequest["command"],
  expectedVersion: number,
  missionId = "mission-client",
  overrides: Partial<ClientCommandRequest> = {},
): ClientCommandRequest {
  return {
    capabilityId: "cap-client",
    command,
    expectedVersion,
    idempotencyKey: `idem-${command}`,
    issuedAt: T0,
    missionId,
    protocol: { major: 1, minor: 0 },
    requestId: `request-${command}`,
    sessionId: "session-client",
    ...overrides,
  };
}

export function job(jobId: string, missionId = "mission-client"): JobEnqueueInput {
  return {
    availableAt: T0,
    createdAt: T0,
    idempotencyKey: `enqueue-${jobId}`,
    jobId,
    maxAttempts: 3,
    missionId,
    payload: {
      artifactId: `payload-${jobId}`,
      sha256: createHash("sha256").update(`payload-${jobId}`).digest("hex"),
    },
    priority: 50,
    taskId: "task-protocol",
  };
}

export async function temporaryDatabase(): Promise<{
  readonly path: string;
  readonly cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "odin-m9-"));
  return {
    cleanup: async () => {
      await rm(directory, { force: true, recursive: true });
    },
    path: join(directory, "odin.sqlite"),
  };
}
