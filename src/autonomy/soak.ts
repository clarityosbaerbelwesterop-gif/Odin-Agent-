import { createHash } from "node:crypto";
import {
  AutonomyIntegrityError,
  type SoakObservation,
  type SoakObservationBody,
  type SoakProfile,
  type SoakReport,
} from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const HOUR_MS = 60 * 60 * 1_000;

export const SOAK_PROFILES: Readonly<Record<SoakProfile["id"], SoakProfile>> = Object.freeze({
  "soak-6h-v1": Object.freeze({
    durationMs: 6 * HOUR_MS,
    id: "soak-6h-v1",
    maxBudgetUnits: 6_000,
    maxEquivalentFailures: 3,
    maxEvents: 2_000,
    maxRecoveries: 64,
    maxRestarts: 32,
    minCheckpoints: 6,
  }),
  "soak-12h-v1": Object.freeze({
    durationMs: 12 * HOUR_MS,
    id: "soak-12h-v1",
    maxBudgetUnits: 12_000,
    maxEquivalentFailures: 3,
    maxEvents: 4_000,
    maxRecoveries: 128,
    maxRestarts: 64,
    minCheckpoints: 12,
  }),
  "soak-24h-v1": Object.freeze({
    durationMs: 24 * HOUR_MS,
    id: "soak-24h-v1",
    maxBudgetUnits: 24_000,
    maxEquivalentFailures: 3,
    maxEvents: 8_000,
    maxRecoveries: 256,
    maxRestarts: 128,
    minCheckpoints: 24,
  }),
});

export function createSoakObservation(
  previous: SoakObservation | null,
  body: SoakObservationBody,
): SoakObservation {
  validateObservationBody(body, false);
  const sequence = previous === null ? 1 : previous.sequence + 1;
  const previousHash = previous?.eventHash ?? null;
  const canonical = observationBody(sequence, previousHash, body);
  return Object.freeze({ ...canonical, eventHash: hashJson(canonical) });
}

export function evaluateSoak(
  profileValue: SoakProfile,
  observationsValue: readonly SoakObservation[],
): SoakReport {
  const profile = normalizeProfile(profileValue);
  if (!Array.isArray(observationsValue) || observationsValue.length === 0) {
    throw new AutonomyIntegrityError("Soak observations must be a non-empty array.");
  }
  if (observationsValue.length > profile.maxEvents) {
    throw new AutonomyIntegrityError("Soak event ceiling exceeded.");
  }

  let previous: SoakObservation | null = null;
  let previousAtMs = -1;
  let latestCheckpointHash: string | null = null;
  let checkpointCount = 0;
  let restartCount = 0;
  let recoveryCount = 0;
  let budgetUnitsConsumed = 0;
  let peakPendingJobs = 0;
  const activeGenerations = new Map<string, number>();
  const cancelledJobs = new Set<string>();
  const failureCounts = new Map<string, number>();

  for (const observation of observationsValue) {
    validateObservationBody(observation, true);
    const expectedSequence = previous === null ? 1 : previous.sequence + 1;
    if (observation.sequence !== expectedSequence) {
      throw new AutonomyIntegrityError("Soak sequence is not contiguous.");
    }
    const expectedPreviousHash = previous?.eventHash ?? null;
    if (observation.previousHash !== expectedPreviousHash) {
      throw new AutonomyIntegrityError("Soak hash chain does not match the previous observation.");
    }
    const canonical = observationBody(observation.sequence, observation.previousHash, observation);
    if (!SHA256.test(observation.eventHash) || hashJson(canonical) !== observation.eventHash) {
      throw new AutonomyIntegrityError("Soak observation integrity hash is invalid.");
    }
    if (observation.atMs < previousAtMs) {
      throw new AutonomyIntegrityError("Synthetic soak clock moved backwards.");
    }
    previousAtMs = observation.atMs;

    switch (observation.kind) {
      case "checkpoint": {
        latestCheckpointHash = requiredHash(observation.checkpointHash, "checkpointHash");
        checkpointCount += 1;
        break;
      }
      case "restart": {
        restartCount += 1;
        if (restartCount > profile.maxRestarts) {
          throw new AutonomyIntegrityError("Soak restart ceiling exceeded.");
        }
        const restartCheckpoint = requiredHash(observation.checkpointHash, "checkpointHash");
        if (latestCheckpointHash === null || restartCheckpoint !== latestCheckpointHash) {
          throw new AutonomyIntegrityError(
            "Restart is not bound to the latest trusted checkpoint.",
          );
        }
        break;
      }
      case "lease_reclaimed": {
        recoveryCount += 1;
        if (recoveryCount > profile.maxRecoveries) {
          throw new AutonomyIntegrityError("Soak recovery ceiling exceeded.");
        }
        const jobId = requiredId(observation.jobId, "jobId");
        const generation = requiredGeneration(observation.generation);
        const current = activeGenerations.get(jobId) ?? 0;
        if (generation <= current) {
          throw new AutonomyIntegrityError("Recovered lease generation must strictly increase.");
        }
        activeGenerations.set(jobId, generation);
        peakPendingJobs = Math.max(peakPendingJobs, activeGenerations.size);
        break;
      }
      case "job_settled": {
        const jobId = requiredId(observation.jobId, "jobId");
        const generation = requiredGeneration(observation.generation);
        const current = activeGenerations.get(jobId);
        if (current === undefined || generation !== current) {
          throw new AutonomyIntegrityError("Stale or foreign job settlement generation rejected.");
        }
        if (cancelledJobs.has(jobId) && observation.settlement === "SUCCEEDED") {
          throw new AutonomyIntegrityError("Late success cannot defeat cancellation.");
        }
        if (
          observation.settlement !== "SUCCEEDED" &&
          observation.settlement !== "BLOCKED" &&
          observation.settlement !== "CANCELLED"
        ) {
          throw new AutonomyIntegrityError("Job settlement status is invalid.");
        }
        activeGenerations.delete(jobId);
        break;
      }
      case "cancel_requested": {
        cancelledJobs.add(requiredId(observation.jobId, "jobId"));
        break;
      }
      case "retry_failed": {
        const signature = requiredHash(observation.failureSignature, "failureSignature");
        const count = (failureCounts.get(signature) ?? 0) + 1;
        failureCounts.set(signature, count);
        if (count > profile.maxEquivalentFailures) {
          throw new AutonomyIntegrityError("Equivalent failure anti-loop ceiling exceeded.");
        }
        break;
      }
      case "budget_consumed": {
        const units = observation.budgetUnits;
        if (!Number.isSafeInteger(units) || (units ?? 0) <= 0) {
          throw new AutonomyIntegrityError("Budget consumption must be a positive safe integer.");
        }
        budgetUnitsConsumed += units;
        if (budgetUnitsConsumed > profile.maxBudgetUnits) {
          throw new AutonomyIntegrityError("Soak budget ceiling exceeded.");
        }
        break;
      }
      case "heartbeat":
        break;
    }

    previous = observation;
  }

  if (previous === null || previous.atMs < profile.durationMs) {
    throw new AutonomyIntegrityError("Soak profile did not cover its declared logical duration.");
  }
  if (checkpointCount < profile.minCheckpoints) {
    throw new AutonomyIntegrityError("Soak profile has insufficient trusted checkpoints.");
  }
  if (activeGenerations.size !== 0) {
    throw new AutonomyIntegrityError("Soak ended with unsettled recovered work.");
  }

  const body = {
    budgetUnitsConsumed,
    checkpointCount,
    coveredDurationMs: previous.atMs,
    eventCount: observationsValue.length,
    finalEventHash: previous.eventHash,
    peakPendingJobs,
    profileId: profile.id,
    recoveryCount,
    restartCount,
    terminalState: "PASS" as const,
  };
  return Object.freeze({ ...body, reportHash: hashJson(body) });
}

function normalizeProfile(profile: SoakProfile): SoakProfile {
  const canonical = SOAK_PROFILES[profile.id];
  if (canonical === undefined || hashJson(profile) !== hashJson(canonical)) {
    throw new AutonomyIntegrityError("Soak profile must match a runtime-owned versioned profile.");
  }
  return canonical;
}

function observationBody(
  sequence: number,
  previousHash: string | null,
  value: SoakObservationBody,
): Omit<SoakObservation, "eventHash"> {
  return Object.freeze({
    atMs: value.atMs,
    ...(value.budgetUnits === undefined ? {} : { budgetUnits: value.budgetUnits }),
    ...(value.checkpointHash === undefined ? {} : { checkpointHash: value.checkpointHash }),
    ...(value.failureSignature === undefined ? {} : { failureSignature: value.failureSignature }),
    ...(value.generation === undefined ? {} : { generation: value.generation }),
    ...(value.jobId === undefined ? {} : { jobId: value.jobId }),
    kind: value.kind,
    previousHash,
    sequence,
    ...(value.settlement === undefined ? {} : { settlement: value.settlement }),
  });
}

function validateObservationBody(value: SoakObservationBody, envelope: boolean): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AutonomyIntegrityError("Soak observation must be an object.");
  }
  if (!Number.isSafeInteger(value.atMs) || value.atMs < 0) {
    throw new AutonomyIntegrityError("Soak synthetic time must be a non-negative safe integer.");
  }
  const shapes: Readonly<Record<string, readonly string[]>> = Object.freeze({
    budget_consumed: ["budgetUnits"],
    cancel_requested: ["jobId"],
    checkpoint: ["checkpointHash"],
    heartbeat: [],
    job_settled: ["generation", "jobId", "settlement"],
    lease_reclaimed: ["generation", "jobId"],
    restart: ["checkpointHash"],
    retry_failed: ["failureSignature"],
  });
  const shape = shapes[value.kind];
  if (shape === undefined) throw new AutonomyIntegrityError("Unsupported soak event kind.");
  const expectedKeys = [
    "atMs",
    "kind",
    ...shape,
    ...(envelope ? ["eventHash", "previousHash", "sequence"] : []),
  ].sort();
  const actualKeys = Object.keys(value).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new AutonomyIntegrityError("Soak observation has unknown, missing, or misplaced fields.");
  }
  switch (value.kind) {
    case "checkpoint":
    case "restart":
      requiredHash(value.checkpointHash, "checkpointHash");
      break;
    case "lease_reclaimed":
      requiredId(value.jobId, "jobId");
      requiredGeneration(value.generation);
      break;
    case "job_settled":
      requiredId(value.jobId, "jobId");
      requiredGeneration(value.generation);
      if (
        value.settlement !== "SUCCEEDED" &&
        value.settlement !== "BLOCKED" &&
        value.settlement !== "CANCELLED"
      ) {
        throw new AutonomyIntegrityError("Job settlement status is invalid.");
      }
      break;
    case "cancel_requested":
      requiredId(value.jobId, "jobId");
      break;
    case "retry_failed":
      requiredHash(value.failureSignature, "failureSignature");
      break;
    case "budget_consumed":
      if (!Number.isSafeInteger(value.budgetUnits) || (value.budgetUnits ?? 0) <= 0) {
        throw new AutonomyIntegrityError("Budget consumption must be a positive safe integer.");
      }
      break;
    case "heartbeat":
      break;
  }
}

function requiredHash(value: string | undefined, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new AutonomyIntegrityError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function requiredId(value: string | undefined, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new AutonomyIntegrityError(`${label} is malformed.`);
  }
  return value;
}

function requiredGeneration(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 1) {
    throw new AutonomyIntegrityError("generation must be a positive safe integer.");
  }
  return value as number;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
