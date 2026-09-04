import { createHash } from "node:crypto";
import type { MemoryStore } from "../memory/types.js";
import {
  type LearningAttestationRequest,
  LearningError,
  type LearningEvidenceAuthority,
  type LearningMaintenanceRequest,
  type LearningMaintenanceResult,
  type LearningMemoryCommitResult,
  type LearningNudge,
  type LearningNudgeQuery,
  type LearningProposal,
  type LearningRecord,
  type LearningRecordResult,
  type LearningScope,
  type LearningStatus,
  type LearningSupport,
  type VerifiedLearningAttestation,
} from "./types.js";

const MAX_ID_LENGTH = 200;
const MAX_KEY_LENGTH = 160;
const MAX_LESSON_LENGTH = 1_024;
const MAX_REFERENCE_LENGTH = 1_000;
const MAX_TAGS = 24;
const MAX_TAG_LENGTH = 64;
const MAX_NUDGE_LIMIT = 32;
const MAX_NUDGE_CHARACTERS = 16_384;
const ESTABLISHMENT_SUPPORT = 3;
const DAY_MS = 86_400_000;

interface MutableLearningRecord extends LearningScope {
  id: string;
  key: string;
  lesson: string;
  contentHash: string;
  sensitivity: "internal" | "public";
  tags: string[];
  status: LearningStatus;
  tier: "COLD" | "HOT" | "WARM";
  supports: LearningSupport[];
  firstObservedAt: string;
  lastObservedAt: string;
  sourceReferences: string[];
  evidenceDigest: string;
  memoryId?: string;
  archivedAt?: string;
}

interface ReplayRecord {
  readonly fingerprint: string;
  readonly recordId: string;
  readonly supportIdentity: string;
}

export class EvidenceLearningCurator {
  readonly #authority: LearningEvidenceAuthority;
  readonly #memory: MemoryStore;
  readonly #records = new Map<string, MutableLearningRecord>();
  readonly #replays = new Map<string, ReplayRecord>();

  constructor(authority: LearningEvidenceAuthority, memory: MemoryStore) {
    this.#authority = authority;
    this.#memory = memory;
  }

  async recordVerifiedLesson(value: unknown): Promise<LearningRecordResult> {
    const proposal = normalizeProposal(value);
    const contentHash = sha256(proposal.lesson);
    const request: LearningAttestationRequest = {
      learningKeyHash: sha256(proposal.key),
      lessonContentHash: contentHash,
      missionId: proposal.missionId,
      projectId: proposal.projectId,
      sensitivity: proposal.sensitivity,
      taskId: proposal.taskId,
      userId: proposal.userId,
    };
    const attestation = await this.#authority.attestVerifiedTask(request);
    const verified = validateAttestation(attestation, request, proposal.observedAt);
    const recordId = learningId(proposal, contentHash);
    const supportIdentity = `${proposal.missionId}\u0000${proposal.taskId}`;
    const replayKey = `${proposal.userId}\u0000${proposal.projectId}\u0000${supportIdentity}\u0000${proposal.idempotencyKey}`;
    const fingerprint = stableHash({ proposal, verified });
    const replay = this.#replays.get(replayKey);
    if (replay !== undefined) {
      if (
        replay.fingerprint !== fingerprint ||
        replay.recordId !== recordId ||
        replay.supportIdentity !== supportIdentity
      ) {
        throw new LearningError(
          "CONFLICT",
          "Learning idempotency replay conflicts with prior input.",
        );
      }
      const record = this.#records.get(recordId);
      if (record === undefined) {
        throw new LearningError("CONFLICT", "Learning replay points to missing state.");
      }
      return { record: cloneRecord(record), replayed: true, supportAdded: false };
    }

    let record = this.#records.get(recordId);
    let supportAdded = false;
    const support = supportFromAttestation(verified);
    if (record === undefined) {
      record = {
        contentHash,
        evidenceDigest: evidenceDigest([support]),
        firstObservedAt: proposal.observedAt,
        id: recordId,
        key: proposal.key,
        lastObservedAt: proposal.observedAt,
        lesson: proposal.lesson,
        projectId: proposal.projectId,
        sensitivity: proposal.sensitivity,
        sourceReferences: [proposal.sourceReference],
        status: "CANDIDATE",
        supports: [support],
        tags: [...proposal.tags],
        tier: "WARM",
        userId: proposal.userId,
      };
      this.#records.set(recordId, record);
      supportAdded = true;
    } else {
      if (
        record.key !== proposal.key ||
        record.lesson !== proposal.lesson ||
        record.contentHash !== contentHash ||
        record.userId !== proposal.userId ||
        record.projectId !== proposal.projectId ||
        record.sensitivity !== proposal.sensitivity
      ) {
        throw new LearningError(
          "CONFLICT",
          "Learning record identity conflicts with prior content.",
        );
      }
      const priorSupport = record.supports.find(
        (entry) => entry.missionId === support.missionId && entry.taskId === support.taskId,
      );
      if (priorSupport !== undefined) {
        if (priorSupport.verificationResultHash !== support.verificationResultHash) {
          throw new LearningError(
            "CONFLICT",
            "A task cannot support the same lesson with conflicting verification results.",
          );
        }
      } else {
        record.supports.push(support);
        record.supports.sort(compareSupport);
        record.lastObservedAt = maxTimestamp(record.lastObservedAt, proposal.observedAt);
        record.sourceReferences = uniqueSorted([
          ...record.sourceReferences,
          proposal.sourceReference,
        ]);
        record.tags = uniqueSorted([...record.tags, ...proposal.tags]);
        record.evidenceDigest = evidenceDigest(record.supports);
        record.tier = record.supports.length >= ESTABLISHMENT_SUPPORT ? "HOT" : "WARM";
        delete record.archivedAt;
        supportAdded = true;
      }
    }

    this.#recomputeGroup(groupKey(record));
    this.#replays.set(replayKey, { fingerprint, recordId, supportIdentity });
    return { record: cloneRecord(record), replayed: false, supportAdded };
  }

  async commitEstablishedToMemory(
    recordId: string,
    committedAt: string,
  ): Promise<LearningMemoryCommitResult> {
    assertIdentifier(recordId, "recordId");
    assertCanonicalTimestamp(committedAt, "committedAt");
    const record = this.#records.get(recordId);
    if (record === undefined)
      throw new LearningError("NOT_FOUND", "Learning record was not found.");
    this.#recomputeGroup(groupKey(record));
    if (record.status !== "ESTABLISHED") {
      throw new LearningError(
        "NOT_ELIGIBLE",
        "Only a non-conflicted lesson supported by three distinct verified tasks may enter memory.",
      );
    }
    if (Date.parse(committedAt) < Date.parse(record.lastObservedAt)) {
      throw new LearningError(
        "INVALID_INPUT",
        "Memory commit cannot predate the learned evidence.",
      );
    }

    const memoryId = `learn-${record.id.slice(6)}`;
    const existing = await this.#memory.get(memoryId, {
      projectId: record.projectId,
      userId: record.userId,
    });
    if (existing !== undefined) {
      if (
        existing.status !== "active" ||
        existing.content !== record.lesson ||
        existing.provenance.contentHash !== record.contentHash ||
        existing.provenance.sourceClass !== "verified_learning"
      ) {
        throw new LearningError("CONFLICT", "Existing learning memory conflicts with the lesson.");
      }
      record.memoryId = memoryId;
      return {
        learning: cloneRecord(record),
        memory: { record: existing, replayed: true, storeRevision: this.#memory.revision },
      };
    }

    const memory = await this.#memory.write({
      expectedVersion: 0,
      idempotencyKey: `m13-${record.id}-${record.evidenceDigest.slice(0, 24)}`,
      record: {
        content: record.lesson,
        id: memoryId,
        key: `learned:${record.key}`,
        kind: "semantic",
        provenance: {
          contentHash: record.contentHash,
          observedAt: record.lastObservedAt,
          reference: `learning:${record.id}:${record.evidenceDigest}`,
          sourceClass: "verified_learning",
          sourceVersion: record.evidenceDigest,
        },
        scope: { projectId: record.projectId, userId: record.userId },
        sensitivity: record.sensitivity,
        tags: uniqueSorted(["m13-learning", ...record.tags]),
      },
      updatedAt: committedAt,
    });
    record.memoryId = memoryId;
    return { learning: cloneRecord(record), memory };
  }

  compileNudges(value: unknown): readonly LearningNudge[] {
    const query = normalizeNudgeQuery(value);
    const textTokens = tokenize(query.text);
    const wantedTags = new Set(query.tags ?? []);
    const candidates: LearningNudge[] = [];

    for (const record of this.#records.values()) {
      if (
        record.userId !== query.userId ||
        record.projectId !== query.projectId ||
        record.status === "ARCHIVED" ||
        record.status === "CONFLICTED"
      ) {
        continue;
      }
      const relevance = relevanceScore(record, textTokens, wantedTags);
      if ((textTokens.size > 0 || wantedTags.size > 0) && relevance === 0) continue;
      const score =
        relevance + record.supports.length * 10 + (record.status === "ESTABLISHED" ? 100 : 0);
      candidates.push({
        confidence: record.status === "ESTABLISHED" ? "ESTABLISHED" : "TENTATIVE",
        contentHash: record.contentHash,
        evidenceDigest: record.evidenceDigest,
        evidenceRefs: uniqueSorted(
          record.supports.flatMap((support) => support.evidenceRefs),
        ).slice(0, 8),
        key: record.key,
        lesson: record.lesson,
        recordId: record.id,
        score,
        supportCount: record.supports.length,
        tier: record.tier,
      });
    }

    candidates.sort(
      (left, right) =>
        right.score - left.score ||
        right.supportCount - left.supportCount ||
        left.recordId.localeCompare(right.recordId),
    );
    const selected: LearningNudge[] = [];
    let characters = 0;
    for (const candidate of candidates) {
      if (selected.length >= query.limit) break;
      const cost = candidate.key.length + candidate.lesson.length;
      if (characters + cost > query.maxCharacters) continue;
      selected.push(structuredClone(candidate));
      characters += cost;
    }
    return Object.freeze(selected);
  }

  runMaintenance(value: unknown): LearningMaintenanceResult {
    const request = normalizeMaintenanceRequest(value);
    const evaluatedAt = Date.parse(request.evaluatedAt);
    const cooledIds: string[] = [];
    const archivedIds: string[] = [];
    const affectedGroups = new Set<string>();

    for (const record of this.#records.values()) {
      if (record.userId !== request.userId || record.projectId !== request.projectId) continue;
      if (record.status === "ARCHIVED") continue;
      const ageDays = (evaluatedAt - Date.parse(record.lastObservedAt)) / DAY_MS;
      if (ageDays < 0) {
        throw new LearningError(
          "INVALID_INPUT",
          "Maintenance time cannot predate learning evidence.",
        );
      }
      if (record.status !== "ESTABLISHED" && ageDays >= request.archiveAfterDays) {
        record.status = "ARCHIVED";
        record.tier = "COLD";
        record.archivedAt = request.evaluatedAt;
        archivedIds.push(record.id);
        affectedGroups.add(groupKey(record));
      } else if (ageDays >= request.coldAfterDays && record.tier !== "COLD") {
        record.tier = "COLD";
        cooledIds.push(record.id);
      }
    }

    const reestablishedIds: string[] = [];
    for (const key of affectedGroups) {
      const before = new Map(
        [...this.#records.values()]
          .filter((record) => groupKey(record) === key)
          .map((record) => [record.id, record.status]),
      );
      this.#recomputeGroup(key);
      for (const record of this.#records.values()) {
        if (
          groupKey(record) === key &&
          before.get(record.id) === "CONFLICTED" &&
          record.status === "ESTABLISHED"
        ) {
          if (record.tier !== "COLD") record.tier = "HOT";
          reestablishedIds.push(record.id);
        }
      }
    }

    return {
      archivedIds: Object.freeze(archivedIds.sort()),
      cooledIds: Object.freeze(cooledIds.sort()),
      reestablishedIds: Object.freeze(reestablishedIds.sort()),
    };
  }

  get(recordId: string): LearningRecord | undefined {
    assertIdentifier(recordId, "recordId");
    const record = this.#records.get(recordId);
    return record === undefined ? undefined : cloneRecord(record);
  }

  list(scope: LearningScope): readonly LearningRecord[] {
    validateScope(scope);
    return Object.freeze(
      [...this.#records.values()]
        .filter((record) => record.userId === scope.userId && record.projectId === scope.projectId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(cloneRecord),
    );
  }

  #recomputeGroup(key: string): void {
    const active = [...this.#records.values()].filter(
      (record) => groupKey(record) === key && record.status !== "ARCHIVED",
    );
    const hashes = new Set(active.map((record) => record.contentHash));
    const conflicted = hashes.size > 1;
    for (const record of active) {
      if (conflicted) {
        record.status = "CONFLICTED";
        if (record.tier === "HOT") record.tier = "WARM";
      } else {
        record.status =
          record.supports.length >= ESTABLISHMENT_SUPPORT ? "ESTABLISHED" : "CANDIDATE";
        if (record.tier !== "COLD") {
          record.tier = record.status === "ESTABLISHED" ? "HOT" : "WARM";
        }
      }
    }
  }
}

function normalizeProposal(value: unknown): LearningProposal {
  const object = exactObject(
    value,
    [
      "idempotencyKey",
      "key",
      "lesson",
      "missionId",
      "observedAt",
      "projectId",
      "sensitivity",
      "sourceReference",
      "tags",
      "taskId",
      "userId",
    ],
    "learning proposal",
  );
  const sensitivity = stringValue(object.sensitivity, "sensitivity");
  if (sensitivity !== "internal" && sensitivity !== "public") {
    throw new LearningError(
      "DENIED",
      "Post-task learning cannot automatically persist sensitive or preference content.",
    );
  }
  return Object.freeze({
    idempotencyKey: identifier(object.idempotencyKey, "idempotencyKey"),
    key: normalizeKey(object.key),
    lesson: boundedText(object.lesson, "lesson", MAX_LESSON_LENGTH),
    missionId: identifier(object.missionId, "missionId"),
    observedAt: canonicalTimestamp(object.observedAt, "observedAt"),
    projectId: identifier(object.projectId, "projectId"),
    sensitivity,
    sourceReference: boundedText(object.sourceReference, "sourceReference", MAX_REFERENCE_LENGTH),
    tags: Object.freeze(normalizeTags(object.tags)),
    taskId: identifier(object.taskId, "taskId"),
    userId: identifier(object.userId, "userId"),
  });
}

function validateAttestation(
  value: VerifiedLearningAttestation | null,
  expected: LearningAttestationRequest,
  observedAt: string,
): VerifiedLearningAttestation {
  if (value === null) {
    throw new LearningError("DENIED", "Post-task learning requires independent PASS evidence.");
  }
  const attestation = structuredClone(value);
  validateScope(attestation);
  assertIdentifier(attestation.missionId, "attestation.missionId");
  assertIdentifier(attestation.taskId, "attestation.taskId");
  if (
    attestation.userId !== expected.userId ||
    attestation.projectId !== expected.projectId ||
    attestation.missionId !== expected.missionId ||
    attestation.taskId !== expected.taskId ||
    attestation.learningKeyHash !== expected.learningKeyHash ||
    attestation.lessonContentHash !== expected.lessonContentHash ||
    attestation.sensitivity !== expected.sensitivity ||
    attestation.verdict !== "PASS"
  ) {
    throw new LearningError(
      "DENIED",
      "Learning attestation scope, verdict, or exact content binding did not match.",
    );
  }
  if (!isSha256(attestation.learningKeyHash) || !isSha256(attestation.lessonContentHash)) {
    throw new LearningError("DENIED", "Learning attestation requires SHA-256 content bindings.");
  }
  assertCanonicalTimestamp(attestation.evaluatedAt, "attestation.evaluatedAt");
  if (Date.parse(attestation.evaluatedAt) < Date.parse(observedAt)) {
    throw new LearningError("DENIED", "Learning evidence cannot predate the proposed lesson.");
  }
  if (!isSha256(attestation.verificationResultHash)) {
    throw new LearningError(
      "DENIED",
      "Learning attestation requires a SHA-256 verification result.",
    );
  }
  if (
    !Array.isArray(attestation.evidenceRefs) ||
    attestation.evidenceRefs.length === 0 ||
    new Set(attestation.evidenceRefs).size !== attestation.evidenceRefs.length
  ) {
    throw new LearningError("DENIED", "Learning attestation requires unique evidence references.");
  }
  for (const reference of attestation.evidenceRefs) {
    boundedText(reference, "attestation.evidenceRef", MAX_REFERENCE_LENGTH);
  }
  return Object.freeze({
    ...attestation,
    evidenceRefs: Object.freeze([...attestation.evidenceRefs].sort()),
  });
}

function supportFromAttestation(attestation: VerifiedLearningAttestation): LearningSupport {
  return Object.freeze({
    evaluatedAt: attestation.evaluatedAt,
    evidenceRefs: Object.freeze([...attestation.evidenceRefs]),
    learningKeyHash: attestation.learningKeyHash,
    lessonContentHash: attestation.lessonContentHash,
    missionId: attestation.missionId,
    taskId: attestation.taskId,
    verificationResultHash: attestation.verificationResultHash,
  });
}

function normalizeNudgeQuery(
  value: unknown,
): Required<Omit<LearningNudgeQuery, "tags">> & { readonly tags?: readonly string[] } {
  const object = exactObject(
    value,
    ["evaluatedAt", "limit", "maxCharacters", "projectId", "tags", "text", "userId"],
    "learning nudge query",
    ["tags"],
  );
  const limit = integerValue(object.limit, "limit", 1, MAX_NUDGE_LIMIT);
  const maxCharacters = integerValue(
    object.maxCharacters,
    "maxCharacters",
    1,
    MAX_NUDGE_CHARACTERS,
  );
  const text = stringValue(object.text, "text");
  if (text.length > MAX_LESSON_LENGTH * 4) {
    throw new LearningError("INVALID_INPUT", "Nudge query text is too long.");
  }
  return Object.freeze({
    evaluatedAt: canonicalTimestamp(object.evaluatedAt, "evaluatedAt"),
    limit,
    maxCharacters,
    projectId: identifier(object.projectId, "projectId"),
    ...(object.tags === undefined ? {} : { tags: Object.freeze(normalizeTags(object.tags)) }),
    text,
    userId: identifier(object.userId, "userId"),
  });
}

function normalizeMaintenanceRequest(value: unknown): LearningMaintenanceRequest {
  const object = exactObject(
    value,
    ["archiveAfterDays", "coldAfterDays", "evaluatedAt", "projectId", "userId"],
    "learning maintenance request",
  );
  const coldAfterDays = integerValue(object.coldAfterDays, "coldAfterDays", 1, 3_650);
  const archiveAfterDays = integerValue(object.archiveAfterDays, "archiveAfterDays", 2, 7_300);
  if (archiveAfterDays <= coldAfterDays) {
    throw new LearningError("INVALID_INPUT", "archiveAfterDays must exceed coldAfterDays.");
  }
  return Object.freeze({
    archiveAfterDays,
    coldAfterDays,
    evaluatedAt: canonicalTimestamp(object.evaluatedAt, "evaluatedAt"),
    projectId: identifier(object.projectId, "projectId"),
    userId: identifier(object.userId, "userId"),
  });
}

function learningId(proposal: LearningProposal, contentHash: string): string {
  const digest = stableHash({
    contentHash,
    key: proposal.key,
    projectId: proposal.projectId,
    userId: proposal.userId,
  });
  return `learn-${digest.slice(0, 40)}`;
}

function groupKey(record: Pick<LearningRecord, "key" | "projectId" | "userId">): string {
  return `${record.userId}\u0000${record.projectId}\u0000${record.key}`;
}

function evidenceDigest(supports: readonly LearningSupport[]): string {
  return stableHash(
    [...supports].sort(compareSupport).map((support) => ({
      evaluatedAt: support.evaluatedAt,
      evidenceRefs: [...support.evidenceRefs].sort(),
      learningKeyHash: support.learningKeyHash,
      lessonContentHash: support.lessonContentHash,
      missionId: support.missionId,
      taskId: support.taskId,
      verificationResultHash: support.verificationResultHash,
    })),
  );
}

function relevanceScore(
  record: MutableLearningRecord,
  textTokens: ReadonlySet<string>,
  wantedTags: ReadonlySet<string>,
): number {
  let score = 0;
  const keyTokens = tokenize(record.key);
  const lessonTokens = tokenize(record.lesson);
  const tags = new Set(record.tags);
  for (const token of textTokens) {
    if (keyTokens.has(token)) score += 8;
    if (lessonTokens.has(token)) score += 2;
  }
  for (const tag of wantedTags) {
    if (tags.has(tag)) score += 20;
  }
  return score;
}

function tokenize(value: string): ReadonlySet<string> {
  return new Set(value.toLocaleLowerCase("en-US").match(/[a-z0-9][a-z0-9_-]*/gu) ?? []);
}

function cloneRecord(record: MutableLearningRecord): LearningRecord {
  return Object.freeze({
    ...(record.archivedAt === undefined ? {} : { archivedAt: record.archivedAt }),
    contentHash: record.contentHash,
    evidenceDigest: record.evidenceDigest,
    firstObservedAt: record.firstObservedAt,
    id: record.id,
    key: record.key,
    lastObservedAt: record.lastObservedAt,
    lesson: record.lesson,
    ...(record.memoryId === undefined ? {} : { memoryId: record.memoryId }),
    projectId: record.projectId,
    sensitivity: record.sensitivity,
    sourceReferences: Object.freeze([...record.sourceReferences]),
    status: record.status,
    supportCount: record.supports.length,
    supports: Object.freeze(record.supports.map((support) => structuredClone(support))),
    tags: Object.freeze([...record.tags]),
    tier: record.tier,
    userId: record.userId,
  });
}

function exactObject(
  value: unknown,
  expected: readonly string[],
  label: string,
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LearningError("INVALID_INPUT", `${label} must be an object.`);
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.some((key) => !expected.includes(key))) {
    throw new LearningError("INVALID_INPUT", `${label} contains unknown fields.`);
  }
  for (const key of expected) {
    if (!optional.includes(key) && !(key in object)) {
      throw new LearningError("INVALID_INPUT", `${label} is missing ${key}.`);
    }
  }
  return object;
}

function validateScope(scope: LearningScope): void {
  assertIdentifier(scope.userId, "userId");
  assertIdentifier(scope.projectId, "projectId");
}

function identifier(value: unknown, label: string): string {
  const result = stringValue(value, label).trim();
  assertIdentifier(result, label);
  return result;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function assertIdentifier(value: string, label: string): void {
  if (value === "" || value.length > MAX_ID_LENGTH || hasControlCharacter(value)) {
    throw new LearningError("INVALID_INPUT", `${label} is invalid.`);
  }
}

function normalizeKey(value: unknown): string {
  const result = stringValue(value, "key").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
  if (result === "" || result.length > MAX_KEY_LENGTH) {
    throw new LearningError("INVALID_INPUT", "key is invalid.");
  }
  return result;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_TAGS) {
    throw new LearningError("INVALID_INPUT", `tags must contain at most ${MAX_TAGS} entries.`);
  }
  const tags = value.map((entry) => {
    const tag = stringValue(entry, "tag").trim().toLocaleLowerCase("en-US");
    if (tag === "" || tag.length > MAX_TAG_LENGTH) {
      throw new LearningError("INVALID_INPUT", "tag is invalid.");
    }
    return tag;
  });
  if (new Set(tags).size !== tags.length) {
    throw new LearningError("INVALID_INPUT", "tags must be unique after normalization.");
  }
  return tags.sort();
}

function boundedText(value: unknown, label: string, maximum: number): string {
  const result = stringValue(value, label).trim();
  if (result === "" || result.length > maximum) {
    throw new LearningError("INVALID_INPUT", `${label} is invalid.`);
  }
  return result;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new LearningError("INVALID_INPUT", `${label} must be a string.`);
  }
  return value;
}

function integerValue(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new LearningError(
      "INVALID_INPUT",
      `${label} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value as number;
}

function canonicalTimestamp(value: unknown, label: string): string {
  const result = stringValue(value, label);
  assertCanonicalTimestamp(result, label);
  return result;
}

function assertCanonicalTimestamp(value: string, label: string): void {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new LearningError("INVALID_INPUT", `${label} must be canonical UTC.`);
  }
}

function compareSupport(left: LearningSupport, right: LearningSupport): number {
  return (
    left.missionId.localeCompare(right.missionId) ||
    left.taskId.localeCompare(right.taskId) ||
    left.verificationResultHash.localeCompare(right.verificationResultHash)
  );
}

function maxTimestamp(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function stableHash(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}
