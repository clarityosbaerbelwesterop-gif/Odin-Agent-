import { createHash } from "node:crypto";
import { normalizePackage, SkillRegistry } from "./registry.js";
import {
  type SkillCandidateProposal,
  SkillError,
  type SkillPackageInput,
  type SkillRecord,
} from "./types.js";

export interface SkillSynthesisAttestation {
  readonly missionId: string;
  readonly taskId: string;
  readonly observedAt: string;
  readonly evidenceRefs: readonly string[];
}

export interface SkillSynthesisAuthority {
  attestSolvedTask(
    missionId: string,
    taskId: string,
  ): Promise<SkillSynthesisAttestation | null>;
}

interface ReplayEntry {
  readonly fingerprint: string;
  readonly name: string;
  readonly version: string;
}

export class SkillSynthesisService {
  readonly #registry: SkillRegistry;
  readonly #authority: SkillSynthesisAuthority;
  readonly #replays = new Map<string, ReplayEntry>();

  constructor(registry: SkillRegistry, authority: SkillSynthesisAuthority) {
    this.#registry = registry;
    this.#authority = authority;
  }

  async createCandidate(value: unknown): Promise<SkillRecord> {
    const proposal = normalizeCandidateProposal(value);
    const attestation = await this.#authority.attestSolvedTask(proposal.missionId, proposal.taskId);
    if (
      attestation === null ||
      attestation.missionId !== proposal.missionId ||
      attestation.taskId !== proposal.taskId ||
      attestation.evidenceRefs.length === 0 ||
      Date.parse(attestation.observedAt) < Date.parse(proposal.observedAt)
    ) {
      throw new SkillError("DENIED", "Learned skill synthesis requires a valid solved-task attestation.");
    }
    assertCanonicalTimestamp(attestation.observedAt, "synthesis attestation observedAt");
    for (const reference of attestation.evidenceRefs) assertReference(reference, "synthesis evidence ref");

    const input: SkillPackageInput = {
      instructions: proposal.instructions,
      name: proposal.name,
      provenance: {
        kind: "learned",
        observedAt: proposal.observedAt,
        reference: proposal.sourceReference,
        sourceMissionId: proposal.missionId,
        sourceTaskId: proposal.taskId,
      },
      requiredTools: proposal.requiredTools,
      summary: proposal.summary,
      tags: proposal.tags,
      testRefs: proposal.testRefs,
      trustClass: "learned",
      version: proposal.version,
    };
    const normalized = normalizePackage(input);
    const replayKey = `${proposal.missionId}:${proposal.taskId}:${proposal.idempotencyKey}`;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          attestation: {
            evidenceRefs: [...attestation.evidenceRefs].sort(),
            observedAt: attestation.observedAt,
          },
          contentHash: normalized.contentHash,
        }),
      )
      .digest("hex");
    const replay = this.#replays.get(replayKey);
    if (replay !== undefined) {
      if (
        replay.fingerprint !== fingerprint ||
        replay.name !== normalized.name ||
        replay.version !== normalized.version
      ) {
        throw new SkillError("CONFLICT", "Synthesized skill idempotency replay conflicts with prior input.");
      }
      return this.#registry.resolveForReview(replay.name, replay.version);
    }

    const record = this.#registry.registerCandidate(input);
    this.#replays.set(
      replayKey,
      Object.freeze({ fingerprint, name: normalized.name, version: normalized.version }),
    );
    return record;
  }
}

function normalizeCandidateProposal(value: unknown): SkillCandidateProposal {
  const object = objectValue(value, "skill candidate proposal");
  const expected = [
    "idempotencyKey",
    "instructions",
    "missionId",
    "name",
    "observedAt",
    "requiredTools",
    "sourceReference",
    "summary",
    "tags",
    "taskId",
    "testRefs",
    "version",
  ];
  const keys = Object.keys(object);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new SkillError("INVALID_INPUT", "Skill candidate proposal contains missing or unknown fields.");
  }
  const proposal: SkillCandidateProposal = {
    idempotencyKey: reference(object.idempotencyKey, "candidate idempotency key"),
    instructions: stringValue(object.instructions, "candidate instructions"),
    missionId: reference(object.missionId, "candidate mission id"),
    name: stringValue(object.name, "candidate name"),
    observedAt: canonicalTimestamp(object.observedAt, "candidate observedAt"),
    requiredTools: stringArray(object.requiredTools, "candidate requiredTools"),
    sourceReference: reference(object.sourceReference, "candidate source reference", 2_048),
    summary: stringValue(object.summary, "candidate summary"),
    tags: stringArray(object.tags, "candidate tags"),
    taskId: reference(object.taskId, "candidate task id"),
    testRefs: stringArray(object.testRefs, "candidate testRefs"),
    version: stringValue(object.version, "candidate version"),
  };
  return Object.freeze({
    ...proposal,
    requiredTools: Object.freeze([...proposal.requiredTools]),
    tags: Object.freeze([...proposal.tags]),
    testRefs: Object.freeze([...proposal.testRefs]),
  });
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new SkillError("INVALID_INPUT", `${label} must be an array.`);
  return Object.freeze(value.map((entry) => stringValue(entry, label)));
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SkillError("INVALID_INPUT", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new SkillError("INVALID_INPUT", `${label} must be a string.`);
  return value;
}

function reference(value: unknown, label: string, maximum = 256): string {
  const result = stringValue(value, label).trim();
  if (result === "" || result.length > maximum) {
    throw new SkillError("INVALID_INPUT", `${label} is invalid.`);
  }
  return result;
}

function canonicalTimestamp(value: unknown, label: string): string {
  const result = stringValue(value, label);
  assertCanonicalTimestamp(result, label);
  return result;
}

function assertCanonicalTimestamp(value: string, label: string): void {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new SkillError("INVALID_INPUT", `${label} must be canonical UTC.`);
  }
}

function assertReference(value: string, label: string): void {
  reference(value, label);
}
