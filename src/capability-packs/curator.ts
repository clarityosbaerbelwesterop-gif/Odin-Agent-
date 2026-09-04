import { createHash } from "node:crypto";
import type { SkillVerificationProducer } from "../skills/types.js";
import {
  CapabilityCurationError,
  type CapabilityCandidateRef,
  type CapabilityCurationCaseResult,
  type CapabilityCurationPolicy,
  type CapabilityCurationReport,
  type CapabilityCurationRequest,
  type CapabilityCurationResult,
  type CapabilityDomain,
  type CapabilityEvaluationAttestation,
  type CapabilityEvaluationAuthority,
  type CapabilityEvaluationCase,
  type CapabilityEvaluationRequest,
  type CapabilityGateStatus,
  type CapabilityMeasurement,
  type CapabilitySkillRegistry,
} from "./types.js";

const DEFAULT_POLICY: CapabilityCurationPolicy = Object.freeze({
  maxCases: 64,
  maxContextBytes: 32_768,
  maxEvidenceAgeMs: 7 * 24 * 60 * 60 * 1_000,
  maxProcedureKeys: 64,
  maxTaskClasses: 32,
  minAverageLiftBps: 100,
});

const DOMAINS = new Set<CapabilityDomain>([
  "coding",
  "data-documents",
  "marketing",
  "product-business",
  "research",
  "security",
]);

const INDEPENDENT_PRODUCERS = new Set<SkillVerificationProducer>([
  "independent_test",
  "independent_verifier",
  "trusted_user",
]);

export class CapabilityCurator {
  readonly #registry: CapabilitySkillRegistry;
  readonly #authority: CapabilityEvaluationAuthority;
  readonly #canonicalProcedureKeys: ReadonlySet<string>;
  readonly #policy: CapabilityCurationPolicy;

  constructor(
    registry: CapabilitySkillRegistry,
    authority: CapabilityEvaluationAuthority,
    canonicalProcedureKeys: readonly string[],
    policy: Partial<CapabilityCurationPolicy> = {},
  ) {
    this.#registry = registry;
    this.#authority = authority;
    this.#policy = normalizePolicy({ ...DEFAULT_POLICY, ...policy });
    this.#canonicalProcedureKeys = new Set(
      normalizedIdentifiers(canonicalProcedureKeys, "canonical procedure key", 256),
    );
  }

  async curate(value: unknown): Promise<CapabilityCurationResult> {
    const request = normalizeRequest(value, this.#policy);
    const record = this.#registry.resolveForReview(request.candidate.name, request.candidate.version);

    if (record.package.contentHash !== request.candidate.contentHash) {
      throw new CapabilityCurationError(
        "CONFLICT",
        "Curation request targets a different candidate content hash.",
      );
    }
    if (record.package.trustClass !== "community" || record.lifecycle !== "CANDIDATE") {
      throw new CapabilityCurationError(
        "DENIED",
        "M15 curation accepts only M10 community candidates.",
      );
    }

    const candidateContextBytes = Buffer.byteLength(record.package.instructions, "utf8");
    const novelProcedureKeys = Object.freeze(
      request.procedureKeys.filter((key) => !this.#canonicalProcedureKeys.has(key)),
    );

    if (candidateContextBytes > this.#policy.maxContextBytes) {
      return Object.freeze({
        report: makeReport({
          candidate: request.candidate,
          candidateContextBytes,
          cases: [],
          decision: "FAIL",
          domain: request.domain,
          evaluatedAt: null,
          evidenceRefs: [],
          novelProcedureKeys,
          procedureKeys: request.procedureKeys,
          reasons: ["CONTEXT_LIMIT"],
          taskClasses: request.taskClasses,
          totalLiftBps: 0,
        }),
      });
    }

    if (novelProcedureKeys.length === 0) {
      return Object.freeze({
        report: makeReport({
          candidate: request.candidate,
          candidateContextBytes,
          cases: [],
          decision: "REDUNDANT",
          domain: request.domain,
          evaluatedAt: null,
          evidenceRefs: [],
          novelProcedureKeys,
          procedureKeys: request.procedureKeys,
          reasons: ["NO_NOVEL_PROCEDURE"],
          taskClasses: request.taskClasses,
          totalLiftBps: 0,
        }),
      });
    }

    const evaluationRequest: CapabilityEvaluationRequest = Object.freeze({
      ...request,
      novelProcedureKeys,
      package: record.package,
    });
    const attestation = normalizeAttestation(
      await this.#authority.evaluate(evaluationRequest),
      this.#policy.maxCases,
    );
    validateAttestation(attestation, request, record.package.provenance.observedAt, this.#policy);

    const reasons: string[] = [];
    let totalLiftBps = 0;
    const cases: CapabilityCurationCaseResult[] = attestation.cases.map((entry) => {
      const liftBps = entry.candidate.qualityBps - entry.baseline.qualityBps;
      totalLiftBps += liftBps;
      const caseReasons = caseFailures(entry);
      for (const reason of caseReasons) reasons.push(`CASE:${entry.id}:${reason}`);
      return Object.freeze({
        candidateQualityBps: entry.candidate.qualityBps,
        evidenceRef: entry.evidenceRef,
        id: entry.id,
        liftBps,
        passed: caseReasons.length === 0,
        taskClass: entry.taskClass,
      });
    });

    if (totalLiftBps < this.#policy.minAverageLiftBps * cases.length) {
      reasons.push("AVERAGE_LIFT_BELOW_FLOOR");
    }

    const decision = reasons.length === 0 ? "PASS" : "FAIL";
    const evidenceRefs = uniqueSorted(attestation.cases.map((entry) => entry.evidenceRef));
    const report = makeReport({
      candidate: request.candidate,
      candidateContextBytes,
      cases,
      decision,
      domain: request.domain,
      evaluatedAt: attestation.evaluatedAt,
      evidenceRefs,
      novelProcedureKeys,
      procedureKeys: request.procedureKeys,
      reasons: uniqueSorted(reasons),
      taskClasses: request.taskClasses,
      totalLiftBps,
    });

    if (decision !== "PASS") return Object.freeze({ report });

    const verified = this.#registry.verify({
      contentHash: request.candidate.contentHash,
      evidenceRefs,
      name: request.candidate.name,
      observedAt: attestation.evaluatedAt,
      producerClass: attestation.producerClass,
      status: "PASS",
      version: request.candidate.version,
    });
    return Object.freeze({ report, verified });
  }
}

interface ReportInput {
  readonly candidate: CapabilityCandidateRef;
  readonly candidateContextBytes: number;
  readonly cases: readonly CapabilityCurationCaseResult[];
  readonly decision: CapabilityCurationReport["decision"];
  readonly domain: CapabilityDomain;
  readonly evaluatedAt: string | null;
  readonly evidenceRefs: readonly string[];
  readonly novelProcedureKeys: readonly string[];
  readonly procedureKeys: readonly string[];
  readonly reasons: readonly string[];
  readonly taskClasses: readonly string[];
  readonly totalLiftBps: number;
}

function makeReport(value: ReportInput): CapabilityCurationReport {
  const body = {
    candidate: Object.freeze({ ...value.candidate }),
    candidateContextBytes: value.candidateContextBytes,
    cases: Object.freeze([...value.cases]),
    decision: value.decision,
    domain: value.domain,
    evaluatedAt: value.evaluatedAt,
    evidenceRefs: Object.freeze([...value.evidenceRefs]),
    novelProcedureKeys: Object.freeze([...value.novelProcedureKeys]),
    procedureKeys: Object.freeze([...value.procedureKeys]),
    reasons: Object.freeze([...value.reasons]),
    taskClasses: Object.freeze([...value.taskClasses]),
    totalLiftBps: value.totalLiftBps,
  } as const;
  return Object.freeze({ ...body, reportHash: stableHash(body) });
}

function caseFailures(entry: CapabilityEvaluationCase): string[] {
  const reasons: string[] = [];
  if (entry.candidate.qualityBps < entry.baseline.qualityBps) reasons.push("QUALITY_REGRESSION");
  if (entry.candidate.qualityBps < entry.requiredQualityBps) reasons.push("QUALITY_FLOOR");
  if (entry.candidate.safety !== "PASS") reasons.push("SAFETY");
  if (entry.candidate.authority !== "PASS") reasons.push("AUTHORITY");
  if (entry.candidate.totalTokens > entry.maxCandidateTokens) reasons.push("TOKEN_LIMIT");
  if (entry.candidate.latencyMs > entry.maxCandidateLatencyMs) reasons.push("LATENCY_LIMIT");
  return reasons;
}

function validateAttestation(
  attestation: CapabilityEvaluationAttestation,
  request: CapabilityCurationRequest,
  packageObservedAt: string,
  policy: CapabilityCurationPolicy,
): void {
  if (
    attestation.candidate.name !== request.candidate.name ||
    attestation.candidate.version !== request.candidate.version ||
    attestation.candidate.contentHash !== request.candidate.contentHash ||
    attestation.domain !== request.domain
  ) {
    throw new CapabilityCurationError(
      "EVALUATION_FAILED",
      "Evaluation evidence is foreign to the requested candidate or domain.",
    );
  }
  if (!INDEPENDENT_PRODUCERS.has(attestation.producerClass)) {
    throw new CapabilityCurationError(
      "EVALUATION_FAILED",
      "Capability evaluation must be independently produced.",
    );
  }

  const evaluatedAt = Date.parse(attestation.evaluatedAt);
  const observedAt = Date.parse(request.observedAt);
  if (evaluatedAt > observedAt || observedAt - evaluatedAt > policy.maxEvidenceAgeMs) {
    throw new CapabilityCurationError(
      "EVALUATION_FAILED",
      "Capability evaluation evidence is future-dated or stale.",
    );
  }
  if (evaluatedAt < Date.parse(packageObservedAt)) {
    throw new CapabilityCurationError(
      "EVALUATION_FAILED",
      "Capability evaluation predates candidate provenance.",
    );
  }

  const requestedClasses = new Set(request.taskClasses);
  const coveredClasses = new Set<string>();
  for (const entry of attestation.cases) {
    if (!requestedClasses.has(entry.taskClass)) {
      throw new CapabilityCurationError(
        "EVALUATION_FAILED",
        "Evaluation contains a foreign task class.",
      );
    }
    coveredClasses.add(entry.taskClass);
    if (entry.baseline.safety !== "PASS" || entry.baseline.authority !== "PASS") {
      throw new CapabilityCurationError(
        "EVALUATION_FAILED",
        "Held-out baseline must already satisfy safety and authority gates.",
      );
    }
  }
  if (coveredClasses.size !== requestedClasses.size) {
    throw new CapabilityCurationError(
      "EVALUATION_FAILED",
      "Evaluation does not cover every requested task class.",
    );
  }
}

function normalizeRequest(
  value: unknown,
  policy: CapabilityCurationPolicy,
): CapabilityCurationRequest {
  const object = objectValue(value, "curation request");
  exactKeys(
    object,
    ["candidate", "domain", "observedAt", "procedureKeys", "taskClasses"],
    "curation request",
  );
  return Object.freeze({
    candidate: normalizeCandidate(object.candidate),
    domain: domain(object.domain),
    observedAt: canonicalTimestamp(object.observedAt, "curation observedAt"),
    procedureKeys: normalizedIdentifiers(
      object.procedureKeys,
      "procedure key",
      policy.maxProcedureKeys,
    ),
    taskClasses: normalizedIdentifiers(object.taskClasses, "task class", policy.maxTaskClasses),
  });
}

function normalizeAttestation(value: unknown, maxCases: number): CapabilityEvaluationAttestation {
  const object = objectValue(value, "capability evaluation");
  exactKeys(
    object,
    ["candidate", "cases", "domain", "evaluatedAt", "producerClass"],
    "capability evaluation",
  );
  if (!Array.isArray(object.cases) || object.cases.length === 0 || object.cases.length > maxCases) {
    invalid("Capability evaluation cases are malformed.");
  }
  const cases = object.cases.map(normalizeCase).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(cases.map((entry) => entry.id)).size !== cases.length) {
    invalid("Capability evaluation case ids must be unique.");
  }
  const producerClass = text(
    object.producerClass,
    "evaluation producerClass",
  ) as SkillVerificationProducer;
  const producers = new Set<SkillVerificationProducer>([
    "independent_test",
    "independent_verifier",
    "model",
    "runtime",
    "trusted_user",
    "worker",
  ]);
  if (!producers.has(producerClass)) invalid("Capability evaluation producer is unsupported.");
  return Object.freeze({
    candidate: normalizeCandidate(object.candidate),
    cases: Object.freeze(cases),
    domain: domain(object.domain),
    evaluatedAt: canonicalTimestamp(object.evaluatedAt, "evaluation evaluatedAt"),
    producerClass,
  });
}

function normalizeCase(value: unknown): CapabilityEvaluationCase {
  const object = objectValue(value, "evaluation case");
  exactKeys(
    object,
    [
      "baseline",
      "candidate",
      "evidenceRef",
      "id",
      "maxCandidateLatencyMs",
      "maxCandidateTokens",
      "requiredQualityBps",
      "taskClass",
    ],
    "evaluation case",
  );
  return Object.freeze({
    baseline: normalizeMeasurement(object.baseline, "baseline"),
    candidate: normalizeMeasurement(object.candidate, "candidate"),
    evidenceRef: reference(object.evidenceRef, "evaluation evidenceRef"),
    id: identifier(object.id, "evaluation case id"),
    maxCandidateLatencyMs: safeInteger(
      object.maxCandidateLatencyMs,
      "evaluation maxCandidateLatencyMs",
      0,
      3_600_000,
    ),
    maxCandidateTokens: safeInteger(
      object.maxCandidateTokens,
      "evaluation maxCandidateTokens",
      0,
      10_000_000,
    ),
    requiredQualityBps: safeInteger(
      object.requiredQualityBps,
      "evaluation requiredQualityBps",
      0,
      10_000,
    ),
    taskClass: identifier(object.taskClass, "evaluation taskClass"),
  });
}

function normalizeMeasurement(value: unknown, label: string): CapabilityMeasurement {
  const object = objectValue(value, `${label} measurement`);
  exactKeys(
    object,
    ["authority", "latencyMs", "qualityBps", "safety", "totalTokens"],
    `${label} measurement`,
  );
  return Object.freeze({
    authority: gateStatus(object.authority, `${label} authority`),
    latencyMs: safeInteger(object.latencyMs, `${label} latencyMs`, 0, 3_600_000),
    qualityBps: safeInteger(object.qualityBps, `${label} qualityBps`, 0, 10_000),
    safety: gateStatus(object.safety, `${label} safety`),
    totalTokens: safeInteger(object.totalTokens, `${label} totalTokens`, 0, 10_000_000),
  });
}

function normalizeCandidate(value: unknown): CapabilityCandidateRef {
  const object = objectValue(value, "candidate reference");
  exactKeys(object, ["contentHash", "name", "version"], "candidate reference");
  const contentHash = text(object.contentHash, "candidate contentHash");
  if (!/^[a-f0-9]{64}$/u.test(contentHash)) invalid("Candidate contentHash is invalid.");
  return Object.freeze({
    contentHash,
    name: identifier(object.name, "candidate name"),
    version: version(object.version),
  });
}

function normalizePolicy(value: CapabilityCurationPolicy): CapabilityCurationPolicy {
  return Object.freeze({
    maxCases: safeInteger(value.maxCases, "policy maxCases", 1, 1_000),
    maxContextBytes: safeInteger(value.maxContextBytes, "policy maxContextBytes", 1, 1_048_576),
    maxEvidenceAgeMs: safeInteger(
      value.maxEvidenceAgeMs,
      "policy maxEvidenceAgeMs",
      1,
      365 * 24 * 60 * 60 * 1_000,
    ),
    maxProcedureKeys: safeInteger(value.maxProcedureKeys, "policy maxProcedureKeys", 1, 256),
    maxTaskClasses: safeInteger(value.maxTaskClasses, "policy maxTaskClasses", 1, 128),
    minAverageLiftBps: safeInteger(
      value.minAverageLiftBps,
      "policy minAverageLiftBps",
      0,
      10_000,
    ),
  });
}

function normalizedIdentifiers(value: unknown, label: string, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    invalid(`${label} collection is malformed.`);
  }
  const result = value.map((entry) => identifier(entry, label)).sort();
  if (new Set(result).size !== result.length) invalid(`${label} collection contains duplicates.`);
  return Object.freeze(result);
}

function gateStatus(value: unknown, label: string): CapabilityGateStatus {
  const result = text(value, label);
  if (result !== "PASS" && result !== "FAIL") invalid(`${label} is unsupported.`);
  return result;
}

function domain(value: unknown): CapabilityDomain {
  const result = text(value, "capability domain") as CapabilityDomain;
  if (!DOMAINS.has(result)) invalid("Capability domain is unsupported.");
  return result;
}

function version(value: unknown): string {
  const result = text(value, "candidate version");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/u.test(result)) invalid("Candidate version is invalid.");
  return result;
}

function identifier(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[a-z][a-z0-9_.-]{0,63}$/u.test(result)) invalid(`${label} is invalid.`);
  return result;
}

function reference(value: unknown, label: string): string {
  const result = text(value, label).trim();
  if (result === "" || result.length > 256) invalid(`${label} is invalid.`);
  return result;
}

function canonicalTimestamp(value: unknown, label: string): string {
  const result = text(value, label);
  const parsed = Date.parse(result);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== result) {
    invalid(`${label} must be canonical UTC.`);
  }
  return result;
}

function safeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid(`${label} is outside its allowed integer range.`);
  }
  return value as number;
}

function exactKeys(object: Record<string, unknown>, required: readonly string[], label: string): void {
  const keys = Object.keys(object);
  const allowed = new Set(required);
  if (required.some((key) => !(key in object)) || keys.some((key) => !allowed.has(key))) {
    invalid(`${label} contains missing or unknown fields.`);
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be a string.`);
  return value;
}

function uniqueSorted(value: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(value)].sort());
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function invalid(message: string): never {
  throw new CapabilityCurationError("INVALID_INPUT", message);
}
