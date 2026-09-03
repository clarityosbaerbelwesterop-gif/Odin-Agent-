import { createHash } from "node:crypto";

const MAX_IDENTIFIER = 160;
const MAX_REQUIREMENTS = 64;
const MAX_EVIDENCE = 256;
const MAX_AGE_MS = 365 * 24 * 60 * 60_000;

export type EvidenceLevel = "local" | "integration" | "live";
export type EvidenceStatus = "PASS" | "FAIL";
export type ReleaseGateBlockCode =
  | "DUPLICATE_EVIDENCE"
  | "FAILED_EVIDENCE"
  | "FOREIGN_EVIDENCE"
  | "HASH_MISMATCH"
  | "INVALID"
  | "LEVEL_INSUFFICIENT"
  | "MISSING_EVIDENCE"
  | "POLICY_MISMATCH"
  | "STALE_EVIDENCE";

export interface ReleaseEvidenceInput {
  readonly evidenceId: string;
  readonly releaseId: string;
  readonly kind: string;
  readonly level: EvidenceLevel;
  readonly producer: string;
  readonly status: EvidenceStatus;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly payloadHash: string;
}

export interface ReleaseEvidence extends ReleaseEvidenceInput {
  readonly evidenceHash: string;
}

export interface ReleaseRequirement {
  readonly kind: string;
  readonly minLevel: EvidenceLevel;
}

export interface ReleaseGatePolicyInput {
  readonly policyId: string;
  readonly maxEvidenceAgeMs: number;
  readonly requirements: Readonly<Record<EvidenceLevel, readonly ReleaseRequirement[]>>;
}

export interface ReleaseGatePolicy extends ReleaseGatePolicyInput {
  readonly policyHash: string;
}

export interface ReleaseManifestInput {
  readonly releaseId: string;
  readonly commitSha: string;
  readonly claimLevel: EvidenceLevel;
  readonly configProfileId: string;
  readonly configProfileHash: string;
  readonly suiteId: string;
  readonly suiteHash: string;
  readonly generatedAt: string;
  readonly evidenceIds: readonly string[];
  readonly policy: ReleaseGatePolicy;
}

export interface ReleaseManifest extends Omit<ReleaseManifestInput, "policy"> {
  readonly policyId: string;
  readonly policyHash: string;
  readonly manifestHash: string;
}

export type ReleaseGateDecision =
  | {
      readonly status: "PASS";
      readonly claimLevel: EvidenceLevel;
      readonly manifestHash: string;
      readonly evidenceHashes: readonly string[];
    }
  | {
      readonly status: "BLOCK";
      readonly code: ReleaseGateBlockCode;
      readonly message: string;
    };

export class ReleaseProofError extends Error {
  readonly code: ReleaseGateBlockCode;

  constructor(code: ReleaseGateBlockCode, message: string) {
    super(message);
    this.name = "ReleaseProofError";
    this.code = code;
  }
}

export function createReleaseEvidence(input: ReleaseEvidenceInput): ReleaseEvidence {
  const normalized = normalizeEvidenceInput(input);
  return Object.freeze({ ...normalized, evidenceHash: evidenceHashFor(normalized) });
}

export function createReleaseGatePolicy(input: ReleaseGatePolicyInput): ReleaseGatePolicy {
  if (typeof input !== "object" || input === null) {
    throw new ReleaseProofError("INVALID", "Release gate policy must be an object.");
  }
  const policyId = identifier(input.policyId, "policyId");
  if (!Number.isSafeInteger(input.maxEvidenceAgeMs) || input.maxEvidenceAgeMs < 1 || input.maxEvidenceAgeMs > MAX_AGE_MS) {
    throw new ReleaseProofError("INVALID", "maxEvidenceAgeMs is outside its bound.");
  }
  const requirements = Object.freeze({
    integration: normalizeRequirements(input.requirements?.integration, "integration"),
    live: normalizeRequirements(input.requirements?.live, "live"),
    local: normalizeRequirements(input.requirements?.local, "local"),
  });
  assertLevelSpecificRequirement(requirements.local, "local");
  assertLevelSpecificRequirement(requirements.integration, "integration");
  assertLevelSpecificRequirement(requirements.live, "live");
  assertRequirementSuperset(requirements.local, requirements.integration, "integration");
  assertRequirementSuperset(requirements.integration, requirements.live, "live");
  const normalized = Object.freeze({
    maxEvidenceAgeMs: input.maxEvidenceAgeMs,
    policyId,
    requirements,
  });
  return Object.freeze({ ...normalized, policyHash: sha256(stableStringify(normalized)) });
}

export function createReleaseManifest(input: ReleaseManifestInput): ReleaseManifest {
  if (typeof input !== "object" || input === null) {
    throw new ReleaseProofError("INVALID", "Release manifest must be an object.");
  }
  const policy = normalizePolicy(input.policy);
  const evidenceIds = normalizeEvidenceIds(input.evidenceIds);
  const normalized = Object.freeze({
    claimLevel: level(input.claimLevel),
    commitSha: hash(input.commitSha, "commitSha", 40),
    configProfileHash: hash(input.configProfileHash, "configProfileHash"),
    configProfileId: identifier(input.configProfileId, "configProfileId"),
    evidenceIds,
    generatedAt: canonicalTimestamp(input.generatedAt, "generatedAt"),
    policyHash: policy.policyHash,
    policyId: policy.policyId,
    releaseId: identifier(input.releaseId, "releaseId"),
    suiteHash: hash(input.suiteHash, "suiteHash"),
    suiteId: identifier(input.suiteId, "suiteId"),
  });
  return Object.freeze({ ...normalized, manifestHash: sha256(stableStringify(normalized)) });
}

export function evaluateReleaseGate(
  manifest: ReleaseManifest,
  evidence: readonly ReleaseEvidence[],
  policy: ReleaseGatePolicy,
  now: string,
): ReleaseGateDecision {
  try {
    const normalizedPolicy = normalizePolicy(policy);
    const normalizedManifest = normalizeManifest(manifest);
    if (
      normalizedManifest.policyId !== normalizedPolicy.policyId ||
      normalizedManifest.policyHash !== normalizedPolicy.policyHash
    ) {
      throw new ReleaseProofError("POLICY_MISMATCH", "Release manifest policy does not match the gate policy.");
    }
    const nowMs = Date.parse(canonicalTimestamp(now, "now"));
    const generatedMs = Date.parse(normalizedManifest.generatedAt);
    if (generatedMs > nowMs) {
      throw new ReleaseProofError("INVALID", "Release manifest cannot be generated in the future.");
    }
    if (!Array.isArray(evidence) || evidence.length > MAX_EVIDENCE) {
      throw new ReleaseProofError("INVALID", "Release evidence collection is malformed or too large.");
    }
    const records = new Map<string, ReleaseEvidence>();
    for (const raw of evidence) {
      const record = normalizeEvidence(raw);
      if (records.has(record.evidenceId)) {
        throw new ReleaseProofError("DUPLICATE_EVIDENCE", "Duplicate release evidence ID.");
      }
      if (!normalizedManifest.evidenceIds.includes(record.evidenceId)) {
        throw new ReleaseProofError("FOREIGN_EVIDENCE", "Unreferenced evidence was supplied to the release gate.");
      }
      if (record.releaseId !== normalizedManifest.releaseId) {
        throw new ReleaseProofError("FOREIGN_EVIDENCE", "Release evidence belongs to another release.");
      }
      if (record.status !== "PASS") {
        throw new ReleaseProofError("FAILED_EVIDENCE", "Failed evidence blocks the release claim.");
      }
      const createdMs = Date.parse(record.createdAt);
      if (createdMs > generatedMs || createdMs > nowMs || nowMs - createdMs > normalizedPolicy.maxEvidenceAgeMs) {
        throw new ReleaseProofError("STALE_EVIDENCE", "Release evidence is future-dated or stale.");
      }
      if (record.expiresAt !== undefined && Date.parse(record.expiresAt) <= nowMs) {
        throw new ReleaseProofError("STALE_EVIDENCE", "Release evidence has expired.");
      }
      records.set(record.evidenceId, record);
    }
    if (records.size !== normalizedManifest.evidenceIds.length) {
      throw new ReleaseProofError("MISSING_EVIDENCE", "Manifest evidence references are incomplete.");
    }

    const requirements = normalizedPolicy.requirements[normalizedManifest.claimLevel];
    for (const requirement of requirements) {
      const satisfied = [...records.values()].some(
        (record) => record.kind === requirement.kind && levelRank(record.level) >= levelRank(requirement.minLevel),
      );
      if (!satisfied) {
        throw new ReleaseProofError(
          "LEVEL_INSUFFICIENT",
          `Required evidence kind ${requirement.kind} at ${requirement.minLevel} level is missing.`,
        );
      }
    }
    if (![...records.values()].some((record) => record.level === normalizedManifest.claimLevel)) {
      throw new ReleaseProofError(
        "LEVEL_INSUFFICIENT",
        `Release claim ${normalizedManifest.claimLevel} requires evidence produced at that exact level.`,
      );
    }

    return Object.freeze({
      claimLevel: normalizedManifest.claimLevel,
      evidenceHashes: Object.freeze(
        normalizedManifest.evidenceIds.map((id) => records.get(id)?.evidenceHash ?? ""),
      ),
      manifestHash: normalizedManifest.manifestHash,
      status: "PASS",
    });
  } catch (error: unknown) {
    const normalized =
      error instanceof ReleaseProofError
        ? error
        : new ReleaseProofError("INVALID", "Release gate input could not be validated.");
    return Object.freeze({ code: normalized.code, message: normalized.message, status: "BLOCK" });
  }
}

function normalizeEvidenceInput(input: ReleaseEvidenceInput): ReleaseEvidenceInput {
  if (typeof input !== "object" || input === null) {
    throw new ReleaseProofError("INVALID", "Release evidence must be an object.");
  }
  const expiresAt = input.expiresAt === undefined ? undefined : canonicalTimestamp(input.expiresAt, "expiresAt");
  const createdAt = canonicalTimestamp(input.createdAt, "createdAt");
  if (expiresAt !== undefined && Date.parse(expiresAt) <= Date.parse(createdAt)) {
    throw new ReleaseProofError("INVALID", "Release evidence expiry must follow creation time.");
  }
  return Object.freeze({
    createdAt,
    evidenceId: identifier(input.evidenceId, "evidenceId"),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    kind: identifier(input.kind, "kind"),
    level: level(input.level),
    payloadHash: hash(input.payloadHash, "payloadHash"),
    producer: identifier(input.producer, "producer"),
    releaseId: identifier(input.releaseId, "releaseId"),
    status: status(input.status),
  });
}

function normalizeEvidence(input: ReleaseEvidence): ReleaseEvidence {
  const normalized = normalizeEvidenceInput(input);
  const evidenceHash = hash(input.evidenceHash, "evidenceHash");
  if (evidenceHash !== evidenceHashFor(normalized)) {
    throw new ReleaseProofError("HASH_MISMATCH", "Release evidence hash does not match its content.");
  }
  return Object.freeze({ ...normalized, evidenceHash });
}

function evidenceHashFor(input: ReleaseEvidenceInput): string {
  return sha256(stableStringify(input));
}

function normalizePolicy(input: ReleaseGatePolicy): ReleaseGatePolicy {
  const rebuilt = createReleaseGatePolicy(input);
  if (rebuilt.policyHash !== input.policyHash) {
    throw new ReleaseProofError("HASH_MISMATCH", "Release gate policy hash is invalid.");
  }
  return rebuilt;
}

function normalizeManifest(input: ReleaseManifest): ReleaseManifest {
  if (typeof input !== "object" || input === null) {
    throw new ReleaseProofError("INVALID", "Release manifest must be an object.");
  }
  const normalized = Object.freeze({
    claimLevel: level(input.claimLevel),
    commitSha: hash(input.commitSha, "commitSha", 40),
    configProfileHash: hash(input.configProfileHash, "configProfileHash"),
    configProfileId: identifier(input.configProfileId, "configProfileId"),
    evidenceIds: normalizeEvidenceIds(input.evidenceIds),
    generatedAt: canonicalTimestamp(input.generatedAt, "generatedAt"),
    policyHash: hash(input.policyHash, "policyHash"),
    policyId: identifier(input.policyId, "policyId"),
    releaseId: identifier(input.releaseId, "releaseId"),
    suiteHash: hash(input.suiteHash, "suiteHash"),
    suiteId: identifier(input.suiteId, "suiteId"),
  });
  const manifestHash = hash(input.manifestHash, "manifestHash");
  if (manifestHash !== sha256(stableStringify(normalized))) {
    throw new ReleaseProofError("HASH_MISMATCH", "Release manifest hash does not match its content.");
  }
  return Object.freeze({ ...normalized, manifestHash });
}

function normalizeRequirements(
  input: readonly ReleaseRequirement[] | undefined,
  claimLevel: EvidenceLevel,
): readonly ReleaseRequirement[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_REQUIREMENTS) {
    throw new ReleaseProofError("INVALID", `Requirements for ${claimLevel} are missing or outside bounds.`);
  }
  const normalized = input.map((requirement) => {
    if (typeof requirement !== "object" || requirement === null) {
      throw new ReleaseProofError("INVALID", "Release requirement must be an object.");
    }
    return Object.freeze({ kind: identifier(requirement.kind, "requirement kind"), minLevel: level(requirement.minLevel) });
  });
  normalized.sort((left, right) =>
    left.kind === right.kind
      ? levelRank(left.minLevel) - levelRank(right.minLevel)
      : left.kind.localeCompare(right.kind),
  );
  if (new Set(normalized.map((item) => item.kind)).size !== normalized.length) {
    throw new ReleaseProofError("INVALID", "Release requirement kinds must be unique per claim level.");
  }
  return Object.freeze(normalized);
}

function assertLevelSpecificRequirement(requirements: readonly ReleaseRequirement[], claimLevel: EvidenceLevel): void {
  if (!requirements.some((requirement) => requirement.minLevel === claimLevel)) {
    throw new ReleaseProofError("INVALID", `Policy claim ${claimLevel} requires at least one ${claimLevel}-level requirement.`);
  }
}

function assertRequirementSuperset(
  lower: readonly ReleaseRequirement[],
  higher: readonly ReleaseRequirement[],
  higherLevel: EvidenceLevel,
): void {
  for (const requirement of lower) {
    const candidate = higher.find((item) => item.kind === requirement.kind);
    if (candidate === undefined || levelRank(candidate.minLevel) < levelRank(requirement.minLevel)) {
      throw new ReleaseProofError("INVALID", `${higherLevel} requirements must preserve all lower-level requirements.`);
    }
  }
}

function normalizeEvidenceIds(input: readonly string[]): readonly string[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_EVIDENCE) {
    throw new ReleaseProofError("INVALID", "Manifest evidence IDs are missing or outside bounds.");
  }
  const ids = input.map((value) => identifier(value, "evidenceId")).sort();
  if (new Set(ids).size !== ids.length) {
    throw new ReleaseProofError("DUPLICATE_EVIDENCE", "Manifest evidence IDs must be unique.");
  }
  return Object.freeze(ids);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hash(value: string, label: string, length = 64): string {
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value)) {
    throw new ReleaseProofError("INVALID", `${label} must be a lowercase hex hash.`);
  }
  return value;
}

function identifier(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_IDENTIFIER ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/u.test(value)
  ) {
    throw new ReleaseProofError("INVALID", `${label} is invalid.`);
  }
  return value;
}

function canonicalTimestamp(value: string, label: string): string {
  if (typeof value !== "string") throw new ReleaseProofError("INVALID", `${label} must be a timestamp.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new ReleaseProofError("INVALID", `${label} must be canonical UTC.`);
  }
  return value;
}

function level(value: EvidenceLevel): EvidenceLevel {
  if (value !== "local" && value !== "integration" && value !== "live") {
    throw new ReleaseProofError("INVALID", "Evidence level is invalid.");
  }
  return value;
}

function status(value: EvidenceStatus): EvidenceStatus {
  if (value !== "PASS" && value !== "FAIL") {
    throw new ReleaseProofError("INVALID", "Evidence status is invalid.");
  }
  return value;
}

function levelRank(value: EvidenceLevel): number {
  return value === "local" ? 0 : value === "integration" ? 1 : 2;
}
