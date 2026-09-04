import { createHash } from "node:crypto";
import type { SkillPackage, SkillRecord } from "../skills/types.js";
import type { CapabilityCurationReport, CapabilityDomain } from "./types.js";

export interface CapabilityPackMemberInput {
  readonly contentHash: string;
  readonly curationReportHash: string;
  readonly name: string;
  readonly taskClasses: readonly string[];
  readonly version: string;
}

export interface CapabilityPackInput {
  readonly domain: CapabilityDomain;
  readonly id: string;
  readonly members: readonly CapabilityPackMemberInput[];
  readonly version: string;
}

export interface CapabilityPackMember extends CapabilityPackMemberInput {
  readonly instructionBytes: number;
}

export interface CapabilityPack {
  readonly contextBytes: number;
  readonly domain: CapabilityDomain;
  readonly id: string;
  readonly members: readonly CapabilityPackMember[];
  readonly packHash: string;
  readonly taskClasses: readonly string[];
  readonly version: string;
}

export interface CapabilityPackSummary {
  readonly contextBytes: number;
  readonly domain: CapabilityDomain;
  readonly id: string;
  readonly memberCount: number;
  readonly packHash: string;
  readonly taskClasses: readonly string[];
  readonly version: string;
}

export interface CapabilityPackSkillRegistry {
  resolve(name: string, version: string): SkillPackage;
  resolveForReview(name: string, version: string): SkillRecord;
}

export interface CapabilityPackLimits {
  readonly maxContextBytes: number;
  readonly maxMembers: number;
  readonly maxTaskClasses: number;
}

export type CapabilityPackErrorCode = "CONFLICT" | "DENIED" | "INVALID_INPUT" | "NOT_FOUND";

export class CapabilityPackError extends Error {
  readonly code: CapabilityPackErrorCode;

  constructor(code: CapabilityPackErrorCode, message: string) {
    super(message);
    this.name = "CapabilityPackError";
    this.code = code;
  }
}

const DEFAULT_LIMITS: CapabilityPackLimits = Object.freeze({
  maxContextBytes: 65_536,
  maxMembers: 16,
  maxTaskClasses: 64,
});

const DOMAINS = new Set<CapabilityDomain>([
  "coding",
  "data-documents",
  "marketing",
  "product-business",
  "research",
  "security",
]);

export class CapabilityPackRegistry {
  readonly #skills: CapabilityPackSkillRegistry;
  readonly #reports = new Map<string, CapabilityCurationReport>();
  readonly #packs = new Map<string, CapabilityPack>();
  readonly #limits: CapabilityPackLimits;

  constructor(
    skills: CapabilityPackSkillRegistry,
    trustedReports: readonly CapabilityCurationReport[],
    limits: Partial<CapabilityPackLimits> = {},
  ) {
    this.#skills = skills;
    this.#limits = normalizeLimits({ ...DEFAULT_LIMITS, ...limits });
    if (!Array.isArray(trustedReports) || trustedReports.length > 1_024) {
      invalid("Trusted curation report collection is malformed.");
    }
    for (const report of trustedReports) {
      if (report.decision !== "PASS" || report.reportHash !== curationReportHash(report)) {
        throw new CapabilityPackError(
          "DENIED",
          "Capability packs accept only hash-valid passing trusted curation reports.",
        );
      }
      const existing = this.#reports.get(report.reportHash);
      if (existing !== undefined && existing !== report) {
        throw new CapabilityPackError("CONFLICT", "Curation report hash is duplicated.");
      }
      this.#reports.set(report.reportHash, report);
    }
  }

  register(value: unknown): CapabilityPack {
    const input = normalizePackInput(value, this.#limits);
    const members: CapabilityPackMember[] = [];
    const taskClasses = new Set<string>();
    let contextBytes = 0;

    for (const member of input.members) {
      const report = this.#reports.get(member.curationReportHash);
      if (report === undefined) {
        throw new CapabilityPackError(
          "DENIED",
          "Pack member lacks a trusted passing M15 curation report.",
        );
      }
      if (
        report.domain !== input.domain ||
        report.candidate.name !== member.name ||
        report.candidate.version !== member.version ||
        report.candidate.contentHash !== member.contentHash
      ) {
        throw new CapabilityPackError(
          "CONFLICT",
          "Pack member identity does not match its curation report.",
        );
      }
      const reportClasses = new Set(report.taskClasses);
      if (member.taskClasses.some((taskClass) => !reportClasses.has(taskClass))) {
        throw new CapabilityPackError(
          "CONFLICT",
          "Pack member task class is not covered by its curation report.",
        );
      }

      const record = this.#skills.resolveForReview(member.name, member.version);
      if (record.package.contentHash !== member.contentHash) {
        throw new CapabilityPackError("CONFLICT", "Pack member content hash does not match M10.");
      }
      if (record.lifecycle !== "VERIFIED" && record.lifecycle !== "ACTIVE") {
        throw new CapabilityPackError(
          "DENIED",
          "Pack members must already be M10 VERIFIED or ACTIVE.",
        );
      }

      const instructionBytes = Buffer.byteLength(record.package.instructions, "utf8");
      contextBytes += instructionBytes;
      if (contextBytes > this.#limits.maxContextBytes) {
        throw new CapabilityPackError(
          "DENIED",
          "Capability pack exceeds its context byte ceiling.",
        );
      }
      for (const taskClass of member.taskClasses) taskClasses.add(taskClass);
      if (taskClasses.size > this.#limits.maxTaskClasses) {
        throw new CapabilityPackError("DENIED", "Capability pack exceeds its task-class ceiling.");
      }
      members.push(Object.freeze({ ...member, instructionBytes }));
    }

    const body = {
      contextBytes,
      domain: input.domain,
      id: input.id,
      members: Object.freeze(members),
      taskClasses: Object.freeze([...taskClasses].sort()),
      version: input.version,
    } as const;
    const pack = Object.freeze({ ...body, packHash: stableHash(body) });
    const key = packKey(pack.id, pack.version);
    const existing = this.#packs.get(key);
    if (existing !== undefined) {
      if (existing.packHash === pack.packHash) return existing;
      throw new CapabilityPackError("CONFLICT", `Capability pack ${key} already exists.`);
    }
    this.#packs.set(key, pack);
    return pack;
  }

  listSummaries(): readonly CapabilityPackSummary[] {
    return Object.freeze(
      [...this.#packs.values()]
        .map((pack) =>
          Object.freeze({
            contextBytes: pack.contextBytes,
            domain: pack.domain,
            id: pack.id,
            memberCount: pack.members.length,
            packHash: pack.packHash,
            taskClasses: Object.freeze([...pack.taskClasses]),
            version: pack.version,
          }),
        )
        .sort((left, right) =>
          packKey(left.id, left.version).localeCompare(packKey(right.id, right.version)),
        ),
    );
  }

  resolveMember(
    packId: string,
    packVersion: string,
    name: string,
    versionValue: string,
  ): SkillPackage {
    const pack = this.#packs.get(
      packKey(identifier(packId, "pack id"), version(packVersion, "pack version")),
    );
    if (pack === undefined)
      throw new CapabilityPackError("NOT_FOUND", "Capability pack was not found.");
    const member = pack.members.find(
      (entry) => entry.name === name && entry.version === versionValue,
    );
    if (member === undefined) {
      throw new CapabilityPackError(
        "NOT_FOUND",
        "Skill is not a member of the requested capability pack.",
      );
    }
    const resolved = this.#skills.resolve(name, versionValue);
    if (resolved.contentHash !== member.contentHash) {
      throw new CapabilityPackError(
        "CONFLICT",
        "Resolved M10 member no longer matches pack identity.",
      );
    }
    return resolved;
  }
}

function normalizePackInput(value: unknown, limits: CapabilityPackLimits): CapabilityPackInput {
  const object = objectValue(value, "capability pack");
  exactKeys(object, ["domain", "id", "members", "version"], "capability pack");
  if (
    !Array.isArray(object.members) ||
    object.members.length === 0 ||
    object.members.length > limits.maxMembers
  ) {
    invalid("Capability pack members are malformed.");
  }
  const members = object.members
    .map(normalizeMember)
    .sort((left, right) =>
      `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
    );
  const identities = members.map((member) => `${member.name}@${member.version}`);
  if (new Set(identities).size !== identities.length)
    invalid("Capability pack contains duplicate members.");
  const domainValue = text(object.domain, "capability pack domain") as CapabilityDomain;
  if (!DOMAINS.has(domainValue)) invalid("Capability pack domain is unsupported.");
  return Object.freeze({
    domain: domainValue,
    id: identifier(object.id, "pack id"),
    members: Object.freeze(members),
    version: version(object.version, "pack version"),
  });
}

function normalizeMember(value: unknown): CapabilityPackMemberInput {
  const object = objectValue(value, "capability pack member");
  exactKeys(
    object,
    ["contentHash", "curationReportHash", "name", "taskClasses", "version"],
    "capability pack member",
  );
  return Object.freeze({
    contentHash: sha256(object.contentHash, "member contentHash"),
    curationReportHash: sha256(object.curationReportHash, "member curationReportHash"),
    name: identifier(object.name, "member name"),
    taskClasses: normalizedIdentifiers(object.taskClasses, "member task class", 64),
    version: version(object.version, "member version"),
  });
}

function curationReportHash(report: CapabilityCurationReport): string {
  const body = {
    candidate: report.candidate,
    candidateContextBytes: report.candidateContextBytes,
    cases: report.cases,
    decision: report.decision,
    domain: report.domain,
    evaluatedAt: report.evaluatedAt,
    evidenceRefs: report.evidenceRefs,
    novelProcedureKeys: report.novelProcedureKeys,
    procedureKeys: report.procedureKeys,
    reasons: report.reasons,
    taskClasses: report.taskClasses,
    totalLiftBps: report.totalLiftBps,
  };
  return stableHash(body);
}

function normalizeLimits(value: CapabilityPackLimits): CapabilityPackLimits {
  return Object.freeze({
    maxContextBytes: safeInteger(value.maxContextBytes, "pack maxContextBytes", 1, 1_048_576),
    maxMembers: safeInteger(value.maxMembers, "pack maxMembers", 1, 128),
    maxTaskClasses: safeInteger(value.maxTaskClasses, "pack maxTaskClasses", 1, 256),
  });
}

function normalizedIdentifiers(value: unknown, label: string, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum)
    invalid(`${label} collection is malformed.`);
  const result = value.map((entry) => identifier(entry, label)).sort();
  if (new Set(result).size !== result.length) invalid(`${label} collection contains duplicates.`);
  return Object.freeze(result);
}

function sha256(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[a-f0-9]{64}$/u.test(result)) invalid(`${label} is invalid.`);
  return result;
}

function identifier(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[a-z][a-z0-9_.-]{0,63}$/u.test(result)) invalid(`${label} is invalid.`);
  return result;
}

function version(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/u.test(result)) invalid(`${label} is invalid.`);
  return result;
}

function safeInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid(`${label} is outside its allowed integer range.`);
  }
  return value as number;
}

function exactKeys(
  object: Record<string, unknown>,
  required: readonly string[],
  label: string,
): void {
  const keys = Object.keys(object);
  const allowed = new Set(required);
  if (required.some((key) => !(key in object)) || keys.some((key) => !allowed.has(key))) {
    invalid(`${label} contains missing or unknown fields.`);
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be a string.`);
  return value;
}

function packKey(id: string, versionValue: string): string {
  return `${id}@${versionValue}`;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function invalid(message: string): never {
  throw new CapabilityPackError("INVALID_INPUT", message);
}
