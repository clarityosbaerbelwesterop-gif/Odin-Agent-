import { createHash } from "node:crypto";
import { MissionDomainError, type MissionSnapshot } from "./runtime.js";

export interface MissionCheckpoint {
  readonly schemaVersion: 1;
  readonly missionId: string;
  readonly aggregateVersion: number;
  readonly eventSequence: number;
  readonly snapshotHash: string;
  readonly snapshot: MissionSnapshot;
}

export function createMissionCheckpoint(
  snapshot: MissionSnapshot,
  eventSequence: number,
): MissionCheckpoint {
  if (!Number.isSafeInteger(eventSequence) || eventSequence < 1) {
    throw new MissionDomainError("Checkpoint eventSequence must be a positive safe integer.");
  }
  if (eventSequence !== snapshot.version) {
    throw new MissionDomainError("Checkpoint sequence must match the aggregate version.");
  }
  const cloned = structuredClone(snapshot);
  return {
    aggregateVersion: snapshot.version,
    eventSequence,
    missionId: snapshot.id,
    schemaVersion: 1,
    snapshot: cloned,
    snapshotHash: hashSnapshot(cloned),
  };
}

export function restoreMissionCheckpoint(
  checkpoint: MissionCheckpoint,
  expectedMissionId: string,
): MissionSnapshot {
  if (checkpoint.schemaVersion !== 1) {
    throw new MissionDomainError("Unsupported mission checkpoint schema version.");
  }
  if (checkpoint.missionId !== expectedMissionId || checkpoint.snapshot.id !== expectedMissionId) {
    throw new MissionDomainError(
      "Mission checkpoint identity does not match the requested mission.",
    );
  }
  if (
    checkpoint.aggregateVersion !== checkpoint.eventSequence ||
    checkpoint.aggregateVersion !== checkpoint.snapshot.version
  ) {
    throw new MissionDomainError("Mission checkpoint version metadata is inconsistent.");
  }
  if (hashSnapshot(checkpoint.snapshot) !== checkpoint.snapshotHash) {
    throw new MissionDomainError("Mission checkpoint integrity validation failed.");
  }
  return structuredClone(checkpoint.snapshot);
}

function hashSnapshot(snapshot: MissionSnapshot): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(snapshot)))
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, canonicalize(object[key])]),
  );
}
