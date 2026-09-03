import { createHash } from "node:crypto";
import type { EvidenceLevel } from "./proof.js";
import { ReleaseProofError } from "./proof.js";

const MAX_IDENTIFIER = 160;
const MAX_ARTIFACT_REF = 512;

export interface BackupManifestInput {
  readonly backupId: string;
  readonly level: EvidenceLevel;
  readonly sourceAdapter: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly artifactRef: string;
  readonly artifactHash: string;
  readonly sourceStateHash: string;
}

export interface BackupManifest extends BackupManifestInput {
  readonly manifestHash: string;
}

export interface RestoreVerificationInput {
  readonly backupId: string;
  readonly level: EvidenceLevel;
  readonly producer: string;
  readonly verifiedAt: string;
  readonly restoredStateHash: string;
}

export interface RestoreVerification extends RestoreVerificationInput {
  readonly verificationHash: string;
}

export type RestoreDecision =
  | { readonly status: "PASS"; readonly backupId: string; readonly manifestHash: string; readonly verificationHash: string }
  | { readonly status: "BLOCK"; readonly message: string };

export function createBackupManifest(input: BackupManifestInput): BackupManifest {
  if (typeof input !== "object" || input === null) {
    throw new ReleaseProofError("INVALID", "Backup manifest must be an object.");
  }
  if (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 1 || input.schemaVersion > 1_000_000) {
    throw new ReleaseProofError("INVALID", "Backup schema version is invalid.");
  }
  const normalized = Object.freeze({
    artifactHash: hash(input.artifactHash, "artifactHash"),
    artifactRef: artifactReference(input.artifactRef),
    backupId: identifier(input.backupId, "backupId"),
    createdAt: canonicalTimestamp(input.createdAt, "createdAt"),
    level: evidenceLevel(input.level),
    schemaVersion: input.schemaVersion,
    sourceAdapter: identifier(input.sourceAdapter, "sourceAdapter"),
    sourceStateHash: hash(input.sourceStateHash, "sourceStateHash"),
  });
  return Object.freeze({ ...normalized, manifestHash: sha256(stableStringify(normalized)) });
}

export function createRestoreVerification(input: RestoreVerificationInput): RestoreVerification {
  if (typeof input !== "object" || input === null) {
    throw new ReleaseProofError("INVALID", "Restore verification must be an object.");
  }
  const normalized = Object.freeze({
    backupId: identifier(input.backupId, "backupId"),
    level: evidenceLevel(input.level),
    producer: identifier(input.producer, "producer"),
    restoredStateHash: hash(input.restoredStateHash, "restoredStateHash"),
    verifiedAt: canonicalTimestamp(input.verifiedAt, "verifiedAt"),
  });
  return Object.freeze({ ...normalized, verificationHash: sha256(stableStringify(normalized)) });
}

export function verifyBackupRestore(
  manifest: BackupManifest,
  verification: RestoreVerification,
): RestoreDecision {
  try {
    const trustedManifest = normalizeManifest(manifest);
    const trustedVerification = normalizeVerification(verification);
    if (trustedManifest.backupId !== trustedVerification.backupId) {
      throw new ReleaseProofError("FOREIGN_EVIDENCE", "Restore verification belongs to another backup.");
    }
    if (levelRank(trustedVerification.level) < levelRank(trustedManifest.level)) {
      throw new ReleaseProofError("LEVEL_INSUFFICIENT", "Restore evidence level is weaker than the backup evidence level.");
    }
    if (Date.parse(trustedVerification.verifiedAt) < Date.parse(trustedManifest.createdAt)) {
      throw new ReleaseProofError("INVALID", "Restore verification predates the backup.");
    }
    if (trustedVerification.restoredStateHash !== trustedManifest.sourceStateHash) {
      throw new ReleaseProofError("HASH_MISMATCH", "Restored state does not match the backed-up source state.");
    }
    return Object.freeze({
      backupId: trustedManifest.backupId,
      manifestHash: trustedManifest.manifestHash,
      status: "PASS",
      verificationHash: trustedVerification.verificationHash,
    });
  } catch (error: unknown) {
    return Object.freeze({
      message: error instanceof Error ? error.message : "Backup restore verification failed.",
      status: "BLOCK",
    });
  }
}

function normalizeManifest(input: BackupManifest): BackupManifest {
  const rebuilt = createBackupManifest(input);
  if (rebuilt.manifestHash !== input.manifestHash) {
    throw new ReleaseProofError("HASH_MISMATCH", "Backup manifest hash is invalid.");
  }
  return rebuilt;
}

function normalizeVerification(input: RestoreVerification): RestoreVerification {
  const rebuilt = createRestoreVerification(input);
  if (rebuilt.verificationHash !== input.verificationHash) {
    throw new ReleaseProofError("HASH_MISMATCH", "Restore verification hash is invalid.");
  }
  return rebuilt;
}

function artifactReference(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_ARTIFACT_REF ||
    value.includes("\u0000") ||
    /(?:token|secret|password|credential|authorization)=/iu.test(value)
  ) {
    throw new ReleaseProofError("INVALID", "Backup artifact reference is invalid or secret-like.");
  }
  return value;
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

function hash(value: string, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new ReleaseProofError("INVALID", `${label} must be a lowercase SHA-256 hash.`);
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

function evidenceLevel(value: EvidenceLevel): EvidenceLevel {
  if (value !== "local" && value !== "integration" && value !== "live") {
    throw new ReleaseProofError("INVALID", "Backup evidence level is invalid.");
  }
  return value;
}

function levelRank(value: EvidenceLevel): number {
  return value === "local" ? 0 : value === "integration" ? 1 : 2;
}
