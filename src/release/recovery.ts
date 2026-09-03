import { createHash } from "node:crypto";
import {
  createReleaseEvidence,
  type EvidenceLevel,
  type ReleaseEvidence,
  ReleaseProofError,
} from "./proof.js";

const MAX_IDENTIFIER = 160;
const MAX_ITERATIONS = 1_000_000;
const REQUIRED_SCENARIOS = Object.freeze([
  "backup_restore",
  "cancellation_race",
  "durable_reopen",
  "output_pressure",
  "sandbox_replay",
] as const);

export type RecoveryScenarioKind = (typeof REQUIRED_SCENARIOS)[number];
export type RecoveryScenarioStatus = "PASS" | "FAIL";

export interface RecoveryScenarioResult {
  readonly scenario: RecoveryScenarioKind;
  readonly status: RecoveryScenarioStatus;
  readonly iterations: number;
  readonly maxConcurrency: number;
  readonly evidenceHash: string;
}

export interface RecoveryProofInput {
  readonly proofId: string;
  readonly level: EvidenceLevel;
  readonly suiteId: string;
  readonly suiteHash: string;
  readonly createdAt: string;
  readonly scenarios: readonly RecoveryScenarioResult[];
}

export interface RecoveryProof extends Omit<RecoveryProofInput, "scenarios"> {
  readonly scenarios: readonly RecoveryScenarioResult[];
  readonly status: RecoveryScenarioStatus;
  readonly proofHash: string;
}

export interface RecoveryEvidenceInput {
  readonly evidenceId: string;
  readonly releaseId: string;
  readonly producer: string;
  readonly proof: RecoveryProof;
}

export function createRecoveryProof(input: RecoveryProofInput): RecoveryProof {
  if (typeof input !== "object" || input === null) {
    throw new ReleaseProofError("INVALID", "Recovery proof must be an object.");
  }
  const scenarios = normalizeScenarios(input.scenarios);
  const normalized = Object.freeze({
    createdAt: canonicalTimestamp(input.createdAt, "createdAt"),
    level: evidenceLevel(input.level),
    proofId: identifier(input.proofId, "proofId"),
    scenarios,
    suiteHash: hash(input.suiteHash, "suiteHash"),
    suiteId: identifier(input.suiteId, "suiteId"),
    status: scenarios.every((scenario) => scenario.status === "PASS") ? "PASS" : "FAIL",
  } as const);
  return Object.freeze({ ...normalized, proofHash: sha256(stableStringify(normalized)) });
}

export function createRecoveryReleaseEvidence(input: RecoveryEvidenceInput): ReleaseEvidence {
  const proof = normalizeProof(input.proof);
  return createReleaseEvidence({
    createdAt: proof.createdAt,
    evidenceId: identifier(input.evidenceId, "evidenceId"),
    kind: "load.recovery",
    level: proof.level,
    payloadHash: proof.proofHash,
    producer: identifier(input.producer, "producer"),
    releaseId: identifier(input.releaseId, "releaseId"),
    status: proof.status,
  });
}

function normalizeProof(input: RecoveryProof): RecoveryProof {
  const rebuilt = createRecoveryProof(input);
  if (rebuilt.proofHash !== input.proofHash || rebuilt.status !== input.status) {
    throw new ReleaseProofError("HASH_MISMATCH", "Recovery proof integrity check failed.");
  }
  return rebuilt;
}

function normalizeScenarios(input: readonly RecoveryScenarioResult[]): readonly RecoveryScenarioResult[] {
  if (!Array.isArray(input) || input.length !== REQUIRED_SCENARIOS.length) {
    throw new ReleaseProofError("INVALID", "Recovery proof must contain every required scenario exactly once.");
  }
  const normalized = input.map((scenario) => normalizeScenario(scenario));
  normalized.sort((left, right) => left.scenario.localeCompare(right.scenario));
  const names = normalized.map((scenario) => scenario.scenario);
  if (
    names.some((name, index) => name !== [...REQUIRED_SCENARIOS].sort()[index]) ||
    new Set(names).size !== REQUIRED_SCENARIOS.length
  ) {
    throw new ReleaseProofError("INVALID", "Recovery proof scenario set is incomplete or duplicated.");
  }
  return Object.freeze(normalized);
}

function normalizeScenario(input: RecoveryScenarioResult): RecoveryScenarioResult {
  if (typeof input !== "object" || input === null || !isScenario(input.scenario)) {
    throw new ReleaseProofError("INVALID", "Recovery scenario is invalid.");
  }
  if (input.status !== "PASS" && input.status !== "FAIL") {
    throw new ReleaseProofError("INVALID", "Recovery scenario status is invalid.");
  }
  return Object.freeze({
    evidenceHash: hash(input.evidenceHash, "scenario evidenceHash"),
    iterations: boundedInteger(input.iterations, "iterations"),
    maxConcurrency: boundedInteger(input.maxConcurrency, "maxConcurrency"),
    scenario: input.scenario,
    status: input.status,
  });
}

function boundedInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ITERATIONS) {
    throw new ReleaseProofError("INVALID", `${label} must be a bounded positive integer.`);
  }
  return value;
}

function isScenario(value: string): value is RecoveryScenarioKind {
  return (REQUIRED_SCENARIOS as readonly string[]).includes(value);
}

function evidenceLevel(value: EvidenceLevel): EvidenceLevel {
  if (value !== "local" && value !== "integration" && value !== "live") {
    throw new ReleaseProofError("INVALID", "Recovery proof evidence level is invalid.");
  }
  return value;
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
  if (typeof value !== "string") {
    throw new ReleaseProofError("INVALID", `${label} must be a timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new ReleaseProofError("INVALID", `${label} must be canonical UTC.`);
  }
  return value;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
