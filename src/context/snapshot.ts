import { createHash } from "node:crypto";

const MAX_ENTRIES_PER_SECTION = 128;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_REFERENCE_LENGTH = 1_000;
const MAX_SUMMARY_LENGTH = 2_000;

export interface SessionSnapshotFact {
  readonly id: string;
  readonly summary: string;
  readonly sourceRef: string;
}

export interface SessionSnapshotTestStatus extends SessionSnapshotFact {
  readonly status: "FAIL" | "NOT_RUN" | "PASS";
}

export interface SessionMissionSummary {
  readonly objective: string;
  readonly phase: string;
  readonly currentMilestone: string;
  readonly currentTask: string;
}

export interface SessionNextAction {
  readonly taskId: string;
  readonly summary: string;
}

export interface RawHistoryReference {
  readonly reference: string;
  readonly throughEventVersion: number;
  readonly contentHash: string;
}

export interface SessionSnapshotInput {
  readonly missionId: string;
  readonly eventVersion: number;
  readonly createdAt: string;
  readonly mission: SessionMissionSummary;
  readonly decisions: readonly SessionSnapshotFact[];
  readonly architecture: readonly SessionSnapshotFact[];
  readonly completed: readonly SessionSnapshotFact[];
  readonly openTasks: readonly SessionSnapshotFact[];
  readonly failedAttempts: readonly SessionSnapshotFact[];
  readonly importantFiles: readonly SessionSnapshotFact[];
  readonly testStatus: readonly SessionSnapshotTestStatus[];
  readonly knownBugs: readonly SessionSnapshotFact[];
  readonly constraints: readonly SessionSnapshotFact[];
  readonly nextAction: SessionNextAction;
  readonly rawHistory: RawHistoryReference;
}

export interface SessionSnapshot extends SessionSnapshotInput {
  readonly schemaVersion: 1;
  readonly snapshotHash: string;
}

export class SessionSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionSnapshotError";
  }
}

export function createSessionSnapshot(input: SessionSnapshotInput): SessionSnapshot {
  validateSnapshotInput(input);
  const normalized = normalizeSnapshotInput(input);
  return {
    ...normalized,
    schemaVersion: 1,
    snapshotHash: stableHash({ ...normalized, schemaVersion: 1 }),
  };
}

export function restoreSessionSnapshot(
  snapshot: SessionSnapshot,
  expectedMissionId: string,
  minimumEventVersion = 1,
): SessionSnapshot {
  assertIdentifier(expectedMissionId, "expectedMissionId");
  assertPositiveVersion(minimumEventVersion, "minimumEventVersion");
  if (snapshot.schemaVersion !== 1) {
    throw new SessionSnapshotError("Unsupported session snapshot schema version.");
  }
  validateSnapshotInput(snapshot);
  if (snapshot.missionId !== expectedMissionId) {
    throw new SessionSnapshotError("Session snapshot belongs to a different mission.");
  }
  if (snapshot.eventVersion < minimumEventVersion) {
    throw new SessionSnapshotError("Session snapshot is older than the required event version.");
  }
  const normalized = normalizeSnapshotInput(snapshot);
  const expectedHash = stableHash({ ...normalized, schemaVersion: 1 });
  if (snapshot.snapshotHash !== expectedHash) {
    throw new SessionSnapshotError("Session snapshot integrity validation failed.");
  }
  return { ...normalized, schemaVersion: 1, snapshotHash: snapshot.snapshotHash };
}

function validateSnapshotInput(input: SessionSnapshotInput): void {
  assertIdentifier(input.missionId, "missionId");
  assertPositiveVersion(input.eventVersion, "eventVersion");
  assertCanonicalTimestamp(input.createdAt, "createdAt");
  assertText(input.mission.objective, "mission.objective", MAX_SUMMARY_LENGTH);
  assertIdentifier(input.mission.phase, "mission.phase");
  assertText(input.mission.currentMilestone, "mission.currentMilestone", MAX_SUMMARY_LENGTH);
  assertText(input.mission.currentTask, "mission.currentTask", MAX_SUMMARY_LENGTH);
  validateFacts(input.decisions, "decisions");
  validateFacts(input.architecture, "architecture");
  validateFacts(input.completed, "completed");
  validateFacts(input.openTasks, "openTasks");
  validateFacts(input.failedAttempts, "failedAttempts");
  validateFacts(input.importantFiles, "importantFiles");
  validateFacts(input.knownBugs, "knownBugs");
  validateFacts(input.constraints, "constraints");
  validateFacts(input.testStatus, "testStatus");
  for (const test of input.testStatus) {
    if (test.status !== "FAIL" && test.status !== "NOT_RUN" && test.status !== "PASS") {
      throw new SessionSnapshotError("testStatus contains an unsupported status.");
    }
  }
  assertIdentifier(input.nextAction.taskId, "nextAction.taskId");
  assertText(input.nextAction.summary, "nextAction.summary", MAX_SUMMARY_LENGTH);
  assertText(input.rawHistory.reference, "rawHistory.reference", MAX_REFERENCE_LENGTH);
  assertPositiveVersion(input.rawHistory.throughEventVersion, "rawHistory.throughEventVersion");
  if (input.rawHistory.throughEventVersion !== input.eventVersion) {
    throw new SessionSnapshotError("Raw history and session snapshot versions must match.");
  }
  if (!/^[a-f0-9]{64}$/u.test(input.rawHistory.contentHash)) {
    throw new SessionSnapshotError("rawHistory.contentHash must be a lowercase SHA-256 digest.");
  }
}

function validateFacts(
  facts: readonly SessionSnapshotFact[],
  section: keyof Pick<
    SessionSnapshotInput,
    | "architecture"
    | "completed"
    | "constraints"
    | "decisions"
    | "failedAttempts"
    | "importantFiles"
    | "knownBugs"
    | "openTasks"
    | "testStatus"
  >,
): void {
  if (facts.length > MAX_ENTRIES_PER_SECTION) {
    throw new SessionSnapshotError(`${section} is limited to ${MAX_ENTRIES_PER_SECTION} entries.`);
  }
  const ids = new Set<string>();
  for (const fact of facts) {
    assertIdentifier(fact.id, `${section}.id`);
    assertText(fact.summary, `${section}.summary`, MAX_SUMMARY_LENGTH);
    assertText(fact.sourceRef, `${section}.sourceRef`, MAX_REFERENCE_LENGTH);
    if (ids.has(fact.id)) throw new SessionSnapshotError(`${section} contains a duplicate ID.`);
    ids.add(fact.id);
  }
}

function normalizeSnapshotInput(input: SessionSnapshotInput): SessionSnapshotInput {
  return {
    architecture: sortFacts(input.architecture),
    completed: sortFacts(input.completed),
    constraints: sortFacts(input.constraints),
    createdAt: input.createdAt,
    decisions: sortFacts(input.decisions),
    eventVersion: input.eventVersion,
    failedAttempts: sortFacts(input.failedAttempts),
    importantFiles: sortFacts(input.importantFiles),
    knownBugs: sortFacts(input.knownBugs),
    mission: structuredClone(input.mission),
    missionId: input.missionId,
    nextAction: structuredClone(input.nextAction),
    openTasks: sortFacts(input.openTasks),
    rawHistory: structuredClone(input.rawHistory),
    testStatus: [...input.testStatus]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => structuredClone(item)),
  };
}

function sortFacts<T extends SessionSnapshotFact>(facts: readonly T[]): T[] {
  return [...facts]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((fact) => structuredClone(fact));
}

function assertIdentifier(value: string, name: string): void {
  assertText(value, name, MAX_IDENTIFIER_LENGTH);
  if (value.includes("\u0000"))
    throw new SessionSnapshotError(`${name} contains a null character.`);
}

function assertText(value: string, name: string, maximum: number): void {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum) {
    throw new SessionSnapshotError(`${name} must contain 1-${maximum} characters.`);
  }
}

function assertPositiveVersion(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new SessionSnapshotError(`${name} must be a positive safe integer.`);
  }
}

function assertCanonicalTimestamp(value: string, name: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new SessionSnapshotError(`${name} must be a canonical UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new SessionSnapshotError(`${name} must be a valid canonical UTC timestamp.`);
  }
  return parsed;
}

function stableHash(value: unknown): string {
  const encoded = JSON.stringify(canonicalize(value));
  if (encoded === undefined) throw new SessionSnapshotError("Cannot hash an undefined snapshot.");
  return createHash("sha256").update(encoded).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .filter((key) => object[key] !== undefined)
      .map((key) => [key, canonicalize(object[key])]),
  );
}
