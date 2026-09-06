import { createHash } from "node:crypto";
import type {
  ClientCommandName,
  ClientMissionProjection,
  ClientStateResponse,
} from "../client/types.js";

const MAX_IDENTIFIER = 192;
const MAX_CLIENT_VERSION = 80;
const MAX_LOCALE = 40;
const MAX_ACTION_ID = 192;
const MAX_APPROVAL_LIFETIME_MS = 15 * 60_000;

export type MobilePlatformClass =
  | "responsive_web"
  | "ios"
  | "ipados"
  | "android"
  | "macos"
  | "desktop_web";

export type MobileExperienceMode = "ONLINE" | "OFFLINE_READ_ONLY";

export type MobileExperienceErrorCode =
  | "MALFORMED"
  | "SCOPE_DENIED"
  | "RESYNC_REQUIRED"
  | "OFFLINE_MUTATION_DENIED"
  | "APPROVAL_INVALID"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_REPLAYED";

export class MobileExperienceError extends Error {
  readonly code: MobileExperienceErrorCode;

  constructor(code: MobileExperienceErrorCode, message: string) {
    super(message);
    this.name = "MobileExperienceError";
    this.code = code;
  }
}

export interface MobileExperienceMetadata {
  readonly platform: MobilePlatformClass;
  readonly clientVersion: string;
  readonly locale: string;
  readonly sessionId: string;
}

export interface MobileMissionPresentation {
  readonly platform: MobilePlatformClass;
  readonly clientVersion: string;
  readonly locale: string;
  readonly mode: MobileExperienceMode;
  readonly missionId: string;
  readonly sessionId: string;
  readonly cursor: number;
  readonly version: number;
  readonly state: ClientMissionProjection["state"];
  readonly objective: string;
  readonly tasks: ClientMissionProjection["tasks"];
  readonly budgetLimits: ClientMissionProjection["budgetLimits"];
  readonly budgetUsage: ClientMissionProjection["budgetUsage"];
  readonly jobs: ClientMissionProjection["jobs"];
  readonly verification: ClientMissionProjection["verification"];
  readonly serverEmittedAt: string;
}

export interface MobileOfflineSnapshot {
  readonly missionId: string;
  readonly sessionId: string;
  readonly cursor: number;
  readonly projection: ClientMissionProjection;
  readonly serverEmittedAt: string;
  readonly cachedAt: string;
  readonly snapshotHash: string;
}

export interface MobileResumeResult {
  readonly mode: "CONTINUED" | "BOOTSTRAPPED";
  readonly presentation: MobileMissionPresentation;
}

export interface MobileApprovalChallengeInput {
  readonly challengeId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly actionId: string;
  readonly sessionId: string;
  readonly expectedVersion: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface MobileApprovalChallenge extends MobileApprovalChallengeInput {
  readonly challengeHash: string;
}

export interface MobileApprovalDecision {
  readonly challengeId: string;
  readonly challengeHash: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly actionId: string;
  readonly sessionId: string;
  readonly expectedVersion: number;
  readonly decidedAt: string;
  readonly decision: "APPROVE" | "DENY";
  readonly online: boolean;
}

export interface MobileApprovalReceipt {
  readonly challengeId: string;
  readonly challengeHash: string;
  readonly decision: "APPROVE" | "DENY";
  readonly decidedAt: string;
  readonly commandAuthority: "REQUIRES_FRESH_SERVER_VALIDATION";
}

export interface MobileNotificationHint {
  readonly missionId: string;
  readonly hintType: "progress" | "approval_required" | "completed" | "blocked";
  readonly cursorHint: number | null;
  readonly emittedAt: string;
}

export interface MobileNotificationOpenResult {
  readonly missionId: string;
  readonly cursorHint: number | null;
  readonly requiresAuthenticatedRefresh: true;
  readonly provesMissionState: false;
}

export function buildMobilePresentation(
  metadataInput: MobileExperienceMetadata,
  response: ClientStateResponse,
  mode: MobileExperienceMode = "ONLINE",
): MobileMissionPresentation {
  const metadata = normalizeMetadata(metadataInput);
  assertStateResponse(response);
  if (response.sessionId !== metadata.sessionId) {
    throw new MobileExperienceError(
      "SCOPE_DENIED",
      "Mobile experience metadata cannot replace server session authority.",
    );
  }
  return freezePresentation({
    budgetLimits: response.projection.budgetLimits,
    budgetUsage: response.projection.budgetUsage,
    clientVersion: metadata.clientVersion,
    cursor: response.nextCursor,
    jobs: response.projection.jobs,
    locale: metadata.locale,
    missionId: response.missionId,
    mode,
    objective: response.projection.objective,
    platform: metadata.platform,
    serverEmittedAt: response.emittedAt,
    sessionId: response.sessionId,
    state: response.projection.state,
    tasks: response.projection.tasks,
    verification: response.projection.verification,
    version: response.projection.version,
  });
}

export function createMobileOfflineSnapshot(
  response: ClientStateResponse,
  cachedAtInput: string,
): MobileOfflineSnapshot {
  assertStateResponse(response);
  const cachedAt = canonicalTimestamp(cachedAtInput, "cachedAt");
  if (Date.parse(cachedAt) < Date.parse(response.emittedAt)) {
    throw new MobileExperienceError("MALFORMED", "Offline snapshot cannot predate server evidence.");
  }
  const base = {
    cachedAt,
    cursor: response.nextCursor,
    missionId: response.missionId,
    projection: structuredClone(response.projection),
    serverEmittedAt: response.emittedAt,
    sessionId: response.sessionId,
  };
  return Object.freeze({ ...base, snapshotHash: mobileOfflineSnapshotHash(base) });
}

export function readMobileOfflineSnapshot(
  metadata: MobileExperienceMetadata,
  snapshotInput: MobileOfflineSnapshot,
): MobileMissionPresentation {
  const snapshot = normalizeOfflineSnapshot(snapshotInput);
  if (snapshot.snapshotHash !== mobileOfflineSnapshotHash(snapshot)) {
    throw new MobileExperienceError("MALFORMED", "Offline snapshot integrity check failed.");
  }
  const response: ClientStateResponse = {
    emittedAt: snapshot.serverEmittedAt,
    events: [],
    fromCursor: snapshot.cursor,
    hasMore: false,
    missionId: snapshot.missionId,
    nextCursor: snapshot.cursor,
    projection: snapshot.projection,
    protocol: { major: 1, minor: 0 },
    requestId: "offline-read-only",
    sessionId: snapshot.sessionId,
  };
  return buildMobilePresentation(metadata, response, "OFFLINE_READ_ONLY");
}

export function resumeMobileExperience(
  metadataInput: MobileExperienceMetadata,
  snapshotInput: MobileOfflineSnapshot,
  response: ClientStateResponse,
): MobileResumeResult {
  const metadata = normalizeMetadata(metadataInput);
  const snapshot = normalizeOfflineSnapshot(snapshotInput);
  assertStateResponse(response);
  if (
    response.sessionId !== snapshot.sessionId ||
    response.missionId !== snapshot.missionId ||
    response.sessionId !== metadata.sessionId
  ) {
    throw new MobileExperienceError("SCOPE_DENIED", "Resume response crossed mobile mission scope.");
  }
  if (
    response.projection.version < snapshot.projection.version ||
    response.nextCursor < snapshot.cursor
  ) {
    throw new MobileExperienceError("RESYNC_REQUIRED", "Resume response is older than cached presentation.");
  }
  if (response.fromCursor === snapshot.cursor) {
    return Object.freeze({
      mode: "CONTINUED",
      presentation: buildMobilePresentation(metadata, response),
    });
  }
  if (response.fromCursor === 0) {
    return Object.freeze({
      mode: "BOOTSTRAPPED",
      presentation: buildMobilePresentation(metadata, response),
    });
  }
  throw new MobileExperienceError(
    "RESYNC_REQUIRED",
    "Resume cursor continuity is unknown; a full authenticated bootstrap is required.",
  );
}

export function assertMobileCommandAllowed(
  presentation: MobileMissionPresentation,
  _command: ClientCommandName,
): void {
  if (presentation.mode !== "ONLINE") {
    throw new MobileExperienceError(
      "OFFLINE_MUTATION_DENIED",
      "Offline mobile presentation is read-only and cannot replay commands later.",
    );
  }
}

export class MobileApprovalAuthority {
  readonly #challenges = new Map<string, MobileApprovalChallenge>();
  readonly #consumed = new Set<string>();

  issue(input: MobileApprovalChallengeInput): MobileApprovalChallenge {
    const challenge = normalizeChallenge(input);
    if (this.#challenges.has(challenge.challengeId) || this.#consumed.has(challenge.challengeId)) {
      throw new MobileExperienceError("APPROVAL_REPLAYED", "Approval challenge id was already issued.");
    }
    const withHash: MobileApprovalChallenge = Object.freeze({
      ...challenge,
      challengeHash: mobileApprovalChallengeHash(challenge),
    });
    this.#challenges.set(withHash.challengeId, withHash);
    return withHash;
  }

  decide(input: MobileApprovalDecision): MobileApprovalReceipt {
    if (!input.online) {
      throw new MobileExperienceError(
        "OFFLINE_MUTATION_DENIED",
        "Offline approval cannot become future authorization.",
      );
    }
    const decidedAt = canonicalTimestamp(input.decidedAt, "decidedAt");
    const stored = this.#challenges.get(identifier(input.challengeId, "challengeId"));
    if (stored === undefined) {
      const code = this.#consumed.has(input.challengeId) ? "APPROVAL_REPLAYED" : "APPROVAL_INVALID";
      throw new MobileExperienceError(code, "Approval challenge is missing or already consumed.");
    }
    if (Date.parse(decidedAt) > Date.parse(stored.expiresAt)) {
      this.#challenges.delete(stored.challengeId);
      this.#consumed.add(stored.challengeId);
      throw new MobileExperienceError("APPROVAL_EXPIRED", "Approval challenge expired.");
    }
    const exact =
      input.challengeHash === stored.challengeHash &&
      input.missionId === stored.missionId &&
      input.taskId === stored.taskId &&
      input.actionId === stored.actionId &&
      input.sessionId === stored.sessionId &&
      input.expectedVersion === stored.expectedVersion;
    if (!exact) {
      throw new MobileExperienceError(
        "APPROVAL_INVALID",
        "Approval decision does not match the exact server-issued challenge.",
      );
    }
    if (input.decision !== "APPROVE" && input.decision !== "DENY") {
      throw new MobileExperienceError("APPROVAL_INVALID", "Approval decision is invalid.");
    }
    this.#challenges.delete(stored.challengeId);
    this.#consumed.add(stored.challengeId);
    return Object.freeze({
      challengeHash: stored.challengeHash,
      challengeId: stored.challengeId,
      commandAuthority: "REQUIRES_FRESH_SERVER_VALIDATION",
      decidedAt,
      decision: input.decision,
    });
  }
}

export function openMobileNotification(
  hintInput: MobileNotificationHint,
): MobileNotificationOpenResult {
  const hint = normalizeNotificationHint(hintInput);
  return Object.freeze({
    cursorHint: hint.cursorHint,
    missionId: hint.missionId,
    provesMissionState: false,
    requiresAuthenticatedRefresh: true,
  });
}

export function mobileApprovalChallengeHash(
  challenge: MobileApprovalChallengeInput,
): string {
  return sha256(
    canonicalPairs({
      actionId: challenge.actionId,
      challengeId: challenge.challengeId,
      expectedVersion: challenge.expectedVersion,
      expiresAt: challenge.expiresAt,
      issuedAt: challenge.issuedAt,
      missionId: challenge.missionId,
      sessionId: challenge.sessionId,
      taskId: challenge.taskId,
    }),
  );
}

export function mobileOfflineSnapshotHash(
  snapshot: Omit<MobileOfflineSnapshot, "snapshotHash"> | MobileOfflineSnapshot,
): string {
  return sha256(
    canonicalPairs({
      cachedAt: snapshot.cachedAt,
      cursor: snapshot.cursor,
      missionId: snapshot.missionId,
      projectionHash: sha256(JSON.stringify(snapshot.projection)),
      serverEmittedAt: snapshot.serverEmittedAt,
      sessionId: snapshot.sessionId,
    }),
  );
}

function normalizeMetadata(input: MobileExperienceMetadata): MobileExperienceMetadata {
  const platform = input.platform;
  const supported: readonly MobilePlatformClass[] = [
    "responsive_web",
    "ios",
    "ipados",
    "android",
    "macos",
    "desktop_web",
  ];
  if (!supported.includes(platform)) {
    throw new MobileExperienceError("MALFORMED", "Unsupported mobile platform class.");
  }
  return Object.freeze({
    clientVersion: boundedString(input.clientVersion, "clientVersion", MAX_CLIENT_VERSION),
    locale: boundedString(input.locale, "locale", MAX_LOCALE),
    platform,
    sessionId: identifier(input.sessionId, "sessionId", 256),
  });
}

function normalizeChallenge(input: MobileApprovalChallengeInput): MobileApprovalChallengeInput {
  const issuedAt = canonicalTimestamp(input.issuedAt, "issuedAt");
  const expiresAt = canonicalTimestamp(input.expiresAt, "expiresAt");
  const lifetime = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (lifetime <= 0 || lifetime > MAX_APPROVAL_LIFETIME_MS) {
    throw new MobileExperienceError("APPROVAL_INVALID", "Approval lifetime is outside server bounds.");
  }
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new MobileExperienceError("APPROVAL_INVALID", "Approval expected version is invalid.");
  }
  return Object.freeze({
    actionId: identifier(input.actionId, "actionId", MAX_ACTION_ID),
    challengeId: identifier(input.challengeId, "challengeId", 256),
    expectedVersion: input.expectedVersion,
    expiresAt,
    issuedAt,
    missionId: identifier(input.missionId, "missionId"),
    sessionId: identifier(input.sessionId, "sessionId", 256),
    taskId: identifier(input.taskId, "taskId"),
  });
}

function normalizeOfflineSnapshot(input: MobileOfflineSnapshot): MobileOfflineSnapshot {
  if (!/^[a-f0-9]{64}$/u.test(input.snapshotHash)) {
    throw new MobileExperienceError("MALFORMED", "Offline snapshot hash is invalid.");
  }
  if (!Number.isSafeInteger(input.cursor) || input.cursor < 0) {
    throw new MobileExperienceError("MALFORMED", "Offline cursor is invalid.");
  }
  if (input.projection.missionId !== input.missionId) {
    throw new MobileExperienceError("SCOPE_DENIED", "Offline projection crossed mission scope.");
  }
  return Object.freeze({
    cachedAt: canonicalTimestamp(input.cachedAt, "cachedAt"),
    cursor: input.cursor,
    missionId: identifier(input.missionId, "missionId"),
    projection: structuredClone(input.projection),
    serverEmittedAt: canonicalTimestamp(input.serverEmittedAt, "serverEmittedAt"),
    sessionId: identifier(input.sessionId, "sessionId", 256),
    snapshotHash: input.snapshotHash,
  });
}

function normalizeNotificationHint(input: MobileNotificationHint): MobileNotificationHint {
  if (
    input.hintType !== "progress" &&
    input.hintType !== "approval_required" &&
    input.hintType !== "completed" &&
    input.hintType !== "blocked"
  ) {
    throw new MobileExperienceError("MALFORMED", "Notification hint type is invalid.");
  }
  if (
    input.cursorHint !== null &&
    (!Number.isSafeInteger(input.cursorHint) || input.cursorHint < 0)
  ) {
    throw new MobileExperienceError("MALFORMED", "Notification cursor hint is invalid.");
  }
  return Object.freeze({
    cursorHint: input.cursorHint,
    emittedAt: canonicalTimestamp(input.emittedAt, "notification.emittedAt"),
    hintType: input.hintType,
    missionId: identifier(input.missionId, "notification.missionId"),
  });
}

function assertStateResponse(response: ClientStateResponse): void {
  canonicalTimestamp(response.emittedAt, "response.emittedAt");
  if (
    response.projection.missionId !== response.missionId ||
    response.events.some((event) => event.missionId !== response.missionId) ||
    !Number.isSafeInteger(response.fromCursor) ||
    response.fromCursor < 0 ||
    !Number.isSafeInteger(response.nextCursor) ||
    response.nextCursor < response.fromCursor
  ) {
    throw new MobileExperienceError("SCOPE_DENIED", "Client response is not a bounded mission projection.");
  }
}

function freezePresentation(value: MobileMissionPresentation): MobileMissionPresentation {
  return Object.freeze({
    ...value,
    budgetLimits: Object.freeze({ ...value.budgetLimits }),
    budgetUsage: Object.freeze({ ...value.budgetUsage }),
    jobs: Object.freeze({ ...value.jobs }),
    tasks: Object.freeze(value.tasks.map((task) => Object.freeze({ ...task, dependsOn: Object.freeze([...task.dependsOn]) }))),
    verification: Object.freeze({
      ...value.verification,
      evidenceRefs: Object.freeze([...value.verification.evidenceRefs]),
    }),
  });
}

function boundedString(value: string, label: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value.trim() !== value) {
    throw new MobileExperienceError("MALFORMED", `${label} is invalid.`);
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) {
      throw new MobileExperienceError("MALFORMED", `${label} contains control characters.`);
    }
  }
  return value;
}

function identifier(value: string, label: string, max = MAX_IDENTIFIER): string {
  return boundedString(value, label, max);
}

function canonicalTimestamp(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new MobileExperienceError("MALFORMED", `${label} must be canonical UTC.`);
  }
  return value;
}

function canonicalPairs(values: Readonly<Record<string, string | number>>): string {
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key.length}:${key}=${String(value).length}:${String(value)}`)
    .join("|");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
