import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSessionSnapshot,
  restoreSessionSnapshot,
  SessionSnapshotError,
  type SessionSnapshotFact,
  type SessionSnapshotInput,
} from "../../src/context/index.js";

const NOW = "2026-09-03T13:00:00.000Z";
const HISTORY_HASH = "a".repeat(64);

function fact(id: string, summary = `Summary for ${id}`): SessionSnapshotFact {
  return { id, sourceRef: `event:${id}`, summary };
}

function input(overrides: Partial<SessionSnapshotInput> = {}): SessionSnapshotInput {
  return {
    architecture: [fact("architecture-2"), fact("architecture-1")],
    completed: [fact("task-complete")],
    constraints: [fact("constraint-1", "Do not exceed the mission budget.")],
    createdAt: NOW,
    decisions: [fact("decision-1")],
    eventVersion: 12,
    failedAttempts: [fact("attempt-1")],
    importantFiles: [fact("file-1", "src/context/engine.ts")],
    knownBugs: [],
    mission: {
      currentMilestone: "M6",
      currentTask: "Compile task context",
      objective: "Build bounded context for the active task.",
      phase: "EXECUTE",
    },
    missionId: "mission-1",
    nextAction: { summary: "Run the verification gates.", taskId: "task-next" },
    openTasks: [fact("task-next")],
    rawHistory: {
      contentHash: HISTORY_HASH,
      reference: "events:mission-1:1-12",
      throughEventVersion: 12,
    },
    testStatus: [{ ...fact("tests"), status: "PASS" }],
    ...overrides,
  };
}

test("structured snapshots normalize deterministically and restore without dropping raw history", () => {
  const source = input();
  const snapshot = createSessionSnapshot(source);
  const restored = restoreSessionSnapshot(snapshot, "mission-1", 12);

  assert.match(snapshot.snapshotHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    snapshot.architecture.map((item) => item.id),
    ["architecture-1", "architecture-2"],
  );
  assert.equal(restored.rawHistory.reference, "events:mission-1:1-12");
  assert.equal(restored.rawHistory.throughEventVersion, restored.eventVersion);
  assert.deepEqual(
    snapshot,
    createSessionSnapshot({ ...source, architecture: [...source.architecture].reverse() }),
  );
});

test("snapshot inputs and restored values are defensive copies", () => {
  const source = input();
  const snapshot = createSessionSnapshot(source);
  const mutableArchitecture = source.architecture as SessionSnapshotFact[];
  mutableArchitecture[0] = fact("tampered-input");
  assert.equal(
    snapshot.architecture.some((item) => item.id === "tampered-input"),
    false,
  );

  const restored = restoreSessionSnapshot(snapshot, "mission-1");
  const mutableRestored = restored.architecture as SessionSnapshotFact[];
  mutableRestored[0] = fact("tampered-output");
  assert.equal(
    snapshot.architecture.some((item) => item.id === "tampered-output"),
    false,
  );
});

test("foreign, stale, and tampered snapshots fail closed", () => {
  const snapshot = createSessionSnapshot(input());
  assert.throws(() => restoreSessionSnapshot(snapshot, "mission-2"), /different mission/u);
  assert.throws(() => restoreSessionSnapshot(snapshot, "mission-1", 13), /older/u);
  assert.throws(
    () =>
      restoreSessionSnapshot(
        { ...snapshot, nextAction: { ...snapshot.nextAction, summary: "Tampered" } },
        "mission-1",
      ),
    /integrity/u,
  );
  assert.throws(
    () => restoreSessionSnapshot({ ...snapshot, schemaVersion: 2 } as never, "mission-1"),
    /Unsupported/u,
  );
});

test("history versions, timestamps, hashes, statuses, and section IDs are validated", () => {
  assert.throws(
    () =>
      createSessionSnapshot(
        input({
          rawHistory: { contentHash: HISTORY_HASH, reference: "events", throughEventVersion: 11 },
        }),
      ),
    /versions must match/u,
  );
  assert.throws(
    () => createSessionSnapshot(input({ createdAt: "2026-09-03T13:00:00Z" })),
    /canonical/u,
  );
  assert.throws(
    () =>
      createSessionSnapshot(
        input({ rawHistory: { contentHash: "bad", reference: "events", throughEventVersion: 12 } }),
      ),
    /SHA-256/u,
  );
  assert.throws(
    () => createSessionSnapshot(input({ decisions: [fact("same"), fact("same")] })),
    /duplicate ID/u,
  );
  assert.throws(
    () =>
      createSessionSnapshot(
        input({ testStatus: [{ ...fact("tests"), status: "UNKNOWN" as "PASS" }] }),
      ),
    SessionSnapshotError,
  );
});
