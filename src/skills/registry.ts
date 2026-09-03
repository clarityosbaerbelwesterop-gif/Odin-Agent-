import { createHash } from "node:crypto";
import {
  SkillError,
  type SkillLifecycle,
  type SkillLifecycleEvent,
  type SkillPackage,
  type SkillPackageInput,
  type SkillPromotionRequest,
  type SkillProvenance,
  type SkillRecord,
  type SkillRegistryLimits,
  type SkillRevocationRequest,
  type SkillSummary,
  type SkillTrustClass,
  type SkillVerificationEvidence,
  type SkillVerificationProducer,
} from "./types.js";

const DEFAULT_LIMITS: SkillRegistryLimits = Object.freeze({
  maxInstructionsBytes: 32_768,
  maxSummaryBytes: 1_024,
  maxTags: 32,
  maxTestRefs: 64,
  maxTools: 32,
});

const INDEPENDENT_PRODUCERS = new Set<SkillVerificationProducer>([
  "independent_test",
  "independent_verifier",
  "trusted_user",
]);
const TRUST_CLASSES = new Set<SkillTrustClass>(["builtin", "community", "learned", "project"]);
const PROVENANCE_KINDS = new Set<SkillProvenance["kind"]>([
  "community",
  "learned",
  "project",
  "system",
]);
const PROMOTION_ACTORS = new Set(["trusted_runtime", "user_approved"] as const);

export class SkillRegistry {
  readonly #events: SkillLifecycleEvent[] = [];
  readonly #records = new Map<string, SkillRecord>();
  readonly #limits: SkillRegistryLimits;

  constructor(limits: Partial<SkillRegistryLimits> = {}) {
    this.#limits = normalizeLimits({ ...DEFAULT_LIMITS, ...limits });
  }

  registerTrusted(value: unknown): SkillRecord {
    const skill = normalizePackage(value, this.#limits);
    if (skill.trustClass !== "builtin" && skill.trustClass !== "project") {
      throw new SkillError(
        "DENIED",
        "Trusted registration accepts builtin or project skills only.",
      );
    }
    if (
      (skill.trustClass === "builtin" && skill.provenance.kind !== "system") ||
      (skill.trustClass === "project" && skill.provenance.kind !== "project")
    ) {
      throw new SkillError(
        "INVALID_INPUT",
        "Trusted skill provenance does not match its trust class.",
      );
    }
    return this.#insert(skill, "VERIFIED");
  }

  registerCandidate(value: unknown): SkillRecord {
    const skill = normalizePackage(value, this.#limits);
    if (skill.trustClass !== "learned" && skill.trustClass !== "community") {
      throw new SkillError(
        "DENIED",
        "Candidate registration accepts learned or community skills only.",
      );
    }
    if (skill.provenance.kind !== skill.trustClass) {
      throw new SkillError("INVALID_INPUT", "Candidate provenance does not match its trust class.");
    }
    if (
      skill.trustClass === "learned" &&
      (skill.provenance.sourceMissionId === undefined ||
        skill.provenance.sourceTaskId === undefined)
    ) {
      throw new SkillError(
        "INVALID_INPUT",
        "Learned skills require source mission and task identity.",
      );
    }
    return this.#insert(skill, "CANDIDATE");
  }

  listAvailableSummaries(): readonly SkillSummary[] {
    return this.#listSummaries(
      (record) => record.lifecycle === "ACTIVE" || record.lifecycle === "VERIFIED",
    );
  }

  listReviewSummaries(): readonly SkillSummary[] {
    return this.#listSummaries(() => true);
  }

  history(name?: string, version?: string): readonly SkillLifecycleEvent[] {
    if (version !== undefined && name === undefined) {
      throw new SkillError("INVALID_INPUT", "Skill history version requires a skill name.");
    }
    if (name !== undefined) assertSkillName(name);
    if (version !== undefined) assertVersion(version);
    return Object.freeze(
      this.#events
        .filter(
          (event) =>
            (name === undefined || event.name === name) &&
            (version === undefined || event.version === version),
        )
        .map(cloneLifecycleEvent),
    );
  }

  resolve(name: string, version: string): SkillPackage {
    const record = this.#record(name, version);
    if (record.lifecycle !== "ACTIVE" && record.lifecycle !== "VERIFIED") {
      throw new SkillError("DENIED", `Skill ${name}@${version} is not loadable.`);
    }
    return clonePackage(record.package);
  }

  resolveActive(name: string): SkillPackage {
    const matches = [...this.#records.values()].filter(
      (record) => record.package.name === name && record.lifecycle === "ACTIVE",
    );
    const active = matches[0];
    if (matches.length !== 1 || active === undefined) {
      throw new SkillError("NOT_FOUND", `No active skill version exists for ${name}.`);
    }
    return clonePackage(active.package);
  }

  resolveForReview(name: string, version: string): SkillRecord {
    return cloneRecord(this.#record(name, version));
  }

  verify(value: unknown): SkillRecord {
    const evidence = normalizeVerificationEvidence(value);
    const current = this.#record(evidence.name, evidence.version);
    if (current.lifecycle === "REVOKED") {
      throw new SkillError("DENIED", "Revoked skills cannot be verified.");
    }
    if (evidence.contentHash !== current.package.contentHash) {
      throw new SkillError(
        "VERIFICATION_FAILED",
        "Verification evidence targets a different package hash.",
      );
    }
    if (evidence.status !== "PASS") {
      throw new SkillError("VERIFICATION_FAILED", "Skill verification evidence did not pass.");
    }
    if (!INDEPENDENT_PRODUCERS.has(evidence.producerClass)) {
      throw new SkillError(
        "VERIFICATION_FAILED",
        "Skill verification must be independently produced.",
      );
    }
    if (Date.parse(evidence.observedAt) < Date.parse(current.package.provenance.observedAt)) {
      throw new SkillError(
        "VERIFICATION_FAILED",
        "Skill verification predates its package provenance.",
      );
    }
    if (current.lifecycle === "VERIFIED" || current.lifecycle === "ACTIVE") {
      return cloneRecord(current);
    }
    const next = freezeRecord({
      activatedAt: null,
      lifecycle: "VERIFIED",
      package: current.package,
      revokedAt: null,
      verifiedAt: evidence.observedAt,
    });
    this.#records.set(skillKey(current.package.name, current.package.version), next);
    this.#appendEvent({
      action: "VERIFIED",
      actor: null,
      contentHash: current.package.contentHash,
      evidenceRefs: evidence.evidenceRefs,
      from: current.lifecycle,
      name: current.package.name,
      occurredAt: evidence.observedAt,
      producerClass: evidence.producerClass,
      to: "VERIFIED",
      version: current.package.version,
    });
    return cloneRecord(next);
  }

  activate(value: unknown): SkillRecord {
    return this.#activate(normalizePromotion(value), false);
  }

  rollback(value: unknown): SkillRecord {
    return this.#activate(normalizePromotion(value), true);
  }

  revoke(value: unknown): SkillRecord {
    const request = normalizeRevocation(value);
    const current = this.#record(request.name, request.version);
    if (current.lifecycle === "REVOKED") return cloneRecord(current);
    if (Date.parse(request.revokedAt) < Date.parse(current.package.provenance.observedAt)) {
      throw new SkillError("INVALID_INPUT", "Skill revocation predates package provenance.");
    }
    const next = freezeRecord({
      ...current,
      lifecycle: "REVOKED",
      revokedAt: request.revokedAt,
    });
    this.#records.set(skillKey(request.name, request.version), next);
    this.#appendEvent({
      action: "REVOKED",
      actor: request.actor,
      contentHash: current.package.contentHash,
      evidenceRefs: [],
      from: current.lifecycle,
      name: request.name,
      occurredAt: request.revokedAt,
      producerClass: null,
      to: "REVOKED",
      version: request.version,
    });
    return cloneRecord(next);
  }

  #activate(request: SkillPromotionRequest, rollback: boolean): SkillRecord {
    const current = this.#record(request.name, request.version);
    if (current.lifecycle !== "VERIFIED" && current.lifecycle !== "ACTIVE") {
      throw new SkillError(
        "DENIED",
        `${rollback ? "Rollback" : "Activation"} requires a verified skill.`,
      );
    }
    if (
      current.verifiedAt !== null &&
      Date.parse(request.promotedAt) < Date.parse(current.verifiedAt)
    ) {
      throw new SkillError("INVALID_INPUT", "Skill activation predates verification.");
    }
    for (const [key, record] of this.#records) {
      if (
        record.package.name === request.name &&
        record.lifecycle === "ACTIVE" &&
        key !== skillKey(request.name, request.version)
      ) {
        this.#records.set(
          key,
          freezeRecord({
            ...record,
            lifecycle: "VERIFIED",
          }),
        );
        this.#appendEvent({
          action: "SUPERSEDED",
          actor: request.actor,
          contentHash: record.package.contentHash,
          evidenceRefs: [],
          from: "ACTIVE",
          name: record.package.name,
          occurredAt: request.promotedAt,
          producerClass: null,
          to: "VERIFIED",
          version: record.package.version,
        });
      }
    }
    const next = freezeRecord({
      ...current,
      activatedAt: request.promotedAt,
      lifecycle: "ACTIVE",
      revokedAt: null,
    });
    this.#records.set(skillKey(request.name, request.version), next);
    this.#appendEvent({
      action: rollback ? "ROLLED_BACK" : "ACTIVATED",
      actor: request.actor,
      contentHash: current.package.contentHash,
      evidenceRefs: [],
      from: current.lifecycle,
      name: request.name,
      occurredAt: request.promotedAt,
      producerClass: null,
      to: "ACTIVE",
      version: request.version,
    });
    return cloneRecord(next);
  }

  #insert(skill: SkillPackage, lifecycle: SkillLifecycle): SkillRecord {
    const key = skillKey(skill.name, skill.version);
    const existing = this.#records.get(key);
    if (existing !== undefined) {
      if (existing.package.contentHash === skill.contentHash && existing.lifecycle === lifecycle) {
        return cloneRecord(existing);
      }
      throw new SkillError(
        "CONFLICT",
        `Skill ${key} is already registered with different state or content.`,
      );
    }
    const record = freezeRecord({
      activatedAt: null,
      lifecycle,
      package: skill,
      revokedAt: null,
      verifiedAt: lifecycle === "VERIFIED" ? skill.provenance.observedAt : null,
    });
    this.#records.set(key, record);
    this.#appendEvent({
      action: "REGISTERED",
      actor: null,
      contentHash: skill.contentHash,
      evidenceRefs: [],
      from: null,
      name: skill.name,
      occurredAt: skill.provenance.observedAt,
      producerClass: null,
      to: lifecycle,
      version: skill.version,
    });
    return cloneRecord(record);
  }

  #appendEvent(event: Omit<SkillLifecycleEvent, "sequence">): void {
    this.#events.push(
      freezeLifecycleEvent({
        ...event,
        sequence: this.#events.length + 1,
      }),
    );
  }

  #record(name: string, version: string): SkillRecord {
    assertSkillName(name);
    assertVersion(version);
    const record = this.#records.get(skillKey(name, version));
    if (record === undefined)
      throw new SkillError("NOT_FOUND", `Unknown skill ${name}@${version}.`);
    return record;
  }

  #listSummaries(predicate: (record: SkillRecord) => boolean): readonly SkillSummary[] {
    return Object.freeze(
      [...this.#records.values()]
        .filter(predicate)
        .map((record) =>
          Object.freeze({
            contentHash: record.package.contentHash,
            lifecycle: record.lifecycle,
            name: record.package.name,
            requiredTools: Object.freeze([...record.package.requiredTools]),
            summary: record.package.summary,
            tags: Object.freeze([...record.package.tags]),
            trustClass: record.package.trustClass,
            version: record.package.version,
          }),
        )
        .sort((left, right) =>
          skillKey(left.name, left.version).localeCompare(skillKey(right.name, right.version)),
        ),
    );
  }
}

export function normalizePackage(
  value: unknown,
  limits: SkillRegistryLimits = DEFAULT_LIMITS,
): SkillPackage {
  const object = objectValue(value, "skill package");
  exactKeys(
    object,
    [
      "instructions",
      "name",
      "provenance",
      "requiredTools",
      "summary",
      "tags",
      "testRefs",
      "trustClass",
      "version",
    ],
    [],
    "skill package",
  );
  const trustClass = text(object.trustClass, "skill trustClass") as SkillTrustClass;
  if (!TRUST_CLASSES.has(trustClass)) invalid("Skill trustClass is unsupported.");
  const normalized: SkillPackageInput = {
    instructions: boundedText(
      object.instructions,
      "skill instructions",
      limits.maxInstructionsBytes,
    ),
    name: skillName(object.name),
    provenance: normalizeProvenance(object.provenance),
    requiredTools: normalizedIdentifiers(
      object.requiredTools,
      "required tool",
      limits.maxTools,
      toolName,
    ),
    summary: boundedText(object.summary, "skill summary", limits.maxSummaryBytes),
    tags: normalizedIdentifiers(object.tags, "skill tag", limits.maxTags, tagName),
    testRefs: normalizedIdentifiers(
      object.testRefs,
      "skill test ref",
      limits.maxTestRefs,
      referenceName,
    ),
    trustClass,
    version: version(object.version),
  };
  return freezePackage({ ...normalized, contentHash: packageHash(normalized) });
}

function normalizeProvenance(value: unknown): SkillProvenance {
  const object = objectValue(value, "skill provenance");
  exactKeys(
    object,
    ["kind", "observedAt", "reference"],
    ["sourceMissionId", "sourceTaskId"],
    "skill provenance",
  );
  const kind = text(object.kind, "skill provenance kind") as SkillProvenance["kind"];
  if (!PROVENANCE_KINDS.has(kind)) invalid("Skill provenance kind is unsupported.");
  const result: SkillProvenance = {
    kind,
    observedAt: canonicalTimestamp(object.observedAt, "skill provenance observedAt"),
    reference: boundedText(object.reference, "skill provenance reference", 2_048),
    ...(object.sourceMissionId === undefined
      ? {}
      : { sourceMissionId: referenceName(object.sourceMissionId, "source mission id") }),
    ...(object.sourceTaskId === undefined
      ? {}
      : { sourceTaskId: referenceName(object.sourceTaskId, "source task id") }),
  };
  if ((result.sourceMissionId === undefined) !== (result.sourceTaskId === undefined)) {
    invalid("Skill provenance source mission and task must be supplied together.");
  }
  return Object.freeze(result);
}

function normalizeVerificationEvidence(value: unknown): SkillVerificationEvidence {
  const object = objectValue(value, "skill verification evidence");
  exactKeys(
    object,
    ["contentHash", "evidenceRefs", "name", "observedAt", "producerClass", "status", "version"],
    [],
    "skill verification evidence",
  );
  const producerClass = text(
    object.producerClass,
    "verification producer",
  ) as SkillVerificationProducer;
  const producers = new Set<SkillVerificationProducer>([
    "independent_test",
    "independent_verifier",
    "model",
    "runtime",
    "trusted_user",
    "worker",
  ]);
  if (!producers.has(producerClass)) invalid("Verification producer is unsupported.");
  const status = text(object.status, "verification status");
  if (status !== "PASS" && status !== "FAIL") invalid("Verification status is unsupported.");
  const evidenceRefs = normalizedIdentifiers(
    object.evidenceRefs,
    "evidence ref",
    64,
    referenceName,
  );
  if (evidenceRefs.length === 0)
    invalid("Verification evidence requires at least one evidence ref.");
  return Object.freeze({
    contentHash: sha256(object.contentHash, "verification contentHash"),
    evidenceRefs,
    name: skillName(object.name),
    observedAt: canonicalTimestamp(object.observedAt, "verification observedAt"),
    producerClass,
    status,
    version: version(object.version),
  });
}

function normalizePromotion(value: unknown): SkillPromotionRequest {
  const object = objectValue(value, "skill promotion request");
  exactKeys(object, ["actor", "name", "promotedAt", "version"], [], "skill promotion request");
  const actor = text(object.actor, "promotion actor") as SkillPromotionRequest["actor"];
  if (!PROMOTION_ACTORS.has(actor)) invalid("Skill promotion actor is unsupported.");
  return Object.freeze({
    actor,
    name: skillName(object.name),
    promotedAt: canonicalTimestamp(object.promotedAt, "promotion timestamp"),
    version: version(object.version),
  });
}

function normalizeRevocation(value: unknown): SkillRevocationRequest {
  const object = objectValue(value, "skill revocation request");
  exactKeys(object, ["actor", "name", "revokedAt", "version"], [], "skill revocation request");
  const actor = text(object.actor, "revocation actor") as SkillRevocationRequest["actor"];
  if (!PROMOTION_ACTORS.has(actor)) invalid("Skill revocation actor is unsupported.");
  return Object.freeze({
    actor,
    name: skillName(object.name),
    revokedAt: canonicalTimestamp(object.revokedAt, "revocation timestamp"),
    version: version(object.version),
  });
}

function normalizeLimits(value: SkillRegistryLimits): SkillRegistryLimits {
  for (const [key, limit] of Object.entries(value)) {
    if (!Number.isSafeInteger(limit) || limit < 1)
      invalid(`Skill registry limit ${key} must be positive.`);
  }
  return Object.freeze({ ...value });
}

function normalizedIdentifiers(
  value: unknown,
  label: string,
  maximum: number,
  normalize: (value: unknown, label: string) => string,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) invalid(`${label} collection is malformed.`);
  const items = value.map((entry) => normalize(entry, label));
  if (new Set(items).size !== items.length) invalid(`${label} collection contains duplicates.`);
  return Object.freeze([...items].sort());
}

function packageHash(value: SkillPackageInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        instructions: value.instructions,
        name: value.name,
        provenance: value.provenance,
        requiredTools: value.requiredTools,
        summary: value.summary,
        tags: value.tags,
        testRefs: value.testRefs,
        trustClass: value.trustClass,
        version: value.version,
      }),
    )
    .digest("hex");
}

function freezePackage(value: SkillPackage): SkillPackage {
  const provenance = Object.freeze({ ...value.provenance });
  return Object.freeze({
    ...value,
    provenance,
    requiredTools: Object.freeze([...value.requiredTools]),
    tags: Object.freeze([...value.tags]),
    testRefs: Object.freeze([...value.testRefs]),
  });
}

function clonePackage(value: SkillPackage): SkillPackage {
  return freezePackage(structuredClone(value));
}

function freezeRecord(value: SkillRecord): SkillRecord {
  return Object.freeze({ ...value, package: freezePackage(value.package) });
}

function cloneRecord(value: SkillRecord): SkillRecord {
  return freezeRecord(structuredClone(value));
}

function freezeLifecycleEvent(value: SkillLifecycleEvent): SkillLifecycleEvent {
  return Object.freeze({
    ...value,
    evidenceRefs: Object.freeze([...value.evidenceRefs]),
  });
}

function cloneLifecycleEvent(value: SkillLifecycleEvent): SkillLifecycleEvent {
  return freezeLifecycleEvent(structuredClone(value));
}

function exactKeys(
  object: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(object);
  if (required.some((key) => !(key in object)) || keys.some((key) => !allowed.has(key))) {
    invalid(`${label} contains missing or unknown fields.`);
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, label: string, maximumBytes: number): string {
  const normalized = text(value, label).trim();
  if (normalized === "" || Buffer.byteLength(normalized, "utf8") > maximumBytes) {
    invalid(`${label} is empty or exceeds its byte limit.`);
  }
  return normalized;
}

function skillName(value: unknown, label = "skill name"): string {
  const result = text(value, label);
  assertPattern(result, label, /^[a-z][a-z0-9_.-]{0,63}$/u);
  return result;
}

function toolName(value: unknown, label: string): string {
  const result = text(value, label);
  assertPattern(result, label, /^[a-z][a-z0-9_.-]{0,63}$/u);
  return result;
}

function tagName(value: unknown, label: string): string {
  const result = text(value, label);
  assertPattern(result, label, /^[a-z0-9][a-z0-9_.-]{0,63}$/u);
  return result;
}

function referenceName(value: unknown, label: string): string {
  const result = text(value, label);
  if (result.length > 256 || result.trim() === "") invalid(`${label} is invalid.`);
  return result;
}

function version(value: unknown, label = "skill version"): string {
  const result = text(value, label);
  assertPattern(result, label, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/u);
  return result;
}

function assertSkillName(value: string): void {
  skillName(value);
}

function assertVersion(value: string): void {
  version(value);
}

function sha256(value: unknown, label: string): string {
  const result = text(value, label);
  assertPattern(result, label, /^[a-f0-9]{64}$/u);
  return result;
}

function canonicalTimestamp(value: unknown, label: string): string {
  const result = text(value, label);
  const parsed = Date.parse(result);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== result)
    invalid(`${label} must be canonical UTC.`);
  return result;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be a string.`);
  return value;
}

function assertPattern(value: string, label: string, pattern: RegExp): void {
  if (!pattern.test(value)) invalid(`${label} is invalid.`);
}

function skillKey(name: string, versionValue: string): string {
  return `${name}@${versionValue}`;
}

function invalid(message: string): never {
  throw new SkillError("INVALID_INPUT", message);
}
