import { createHash } from "node:crypto";
import type { CapabilityDomain } from "../capability-packs/types.js";
import type { SkillPackage } from "../skills/types.js";
import {
  type SkillOsDiscoveryRequest,
  SkillOsError,
  type SkillOsHistoryEvent,
  type SkillOsLimits,
  type SkillOsLoadedSelection,
  type SkillOsPackMemberRef,
  type SkillOsPackRegistration,
  type SkillOsPackSource,
  type SkillOsPackSummary,
  type SkillOsPinRequest,
  type SkillOsRollbackRequest,
  type SkillOsSelection,
  type SkillOsSelectionRequest,
} from "./types.js";

const DEFAULT_LIMITS: SkillOsLimits = Object.freeze({
  maxContextBytes: 65_536,
  maxMembers: 16,
  maxPacks: 128,
  maxSelectionAgeMs: 15 * 60 * 1_000,
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

interface RegisteredPack {
  readonly summary: SkillOsPackSummary;
  readonly members: readonly SkillOsPackMemberRef[];
}

export class SkillOsRuntime {
  readonly #source: SkillOsPackSource;
  readonly #limits: SkillOsLimits;
  readonly #clock: () => string;
  readonly #packs = new Map<string, RegisteredPack>();
  readonly #pins = new Map<string, SkillOsHistoryEvent>();
  readonly #history: SkillOsHistoryEvent[] = [];

  constructor(
    source: SkillOsPackSource,
    limits: Partial<SkillOsLimits> = {},
    clock: () => string = () => new Date().toISOString(),
  ) {
    this.#source = source;
    this.#limits = normalizeLimits({ ...DEFAULT_LIMITS, ...limits });
    this.#clock = clock;
  }

  registerPack(value: unknown): SkillOsPackSummary {
    if (this.#packs.size >= this.#limits.maxPacks) {
      throw new SkillOsError("DENIED", "Skill OS pack ceiling is exhausted.");
    }
    const input = normalizeRegistration(value, this.#limits);
    const sourceSummary = this.#source
      .listSummaries()
      .find((summary) => summary.id === input.id && summary.version === input.version);
    if (sourceSummary === undefined) {
      throw new SkillOsError(
        "DENIED",
        "Skill OS accepts only packs known to the trusted pack source.",
      );
    }
    assertSummaryMatches(input, sourceSummary);

    let contextBytes = 0;
    for (const member of input.members) {
      const trustedMember = this.#source.resolveMemberMetadata(
        input.id,
        input.version,
        member.name,
        member.version,
      );
      if (
        trustedMember.name !== member.name ||
        trustedMember.version !== member.version ||
        trustedMember.contentHash !== member.contentHash ||
        !equalStrings(trustedMember.taskClasses, member.taskClasses)
      ) {
        throw new SkillOsError(
          "CONFLICT",
          "Pack member task scope does not match trusted capability-pack metadata.",
        );
      }
      const loaded = this.#source.resolveMember(
        input.id,
        input.version,
        member.name,
        member.version,
      );
      if (loaded.contentHash !== member.contentHash) {
        throw new SkillOsError(
          "CONFLICT",
          "Pack member hash changed during Skill OS registration.",
        );
      }
      contextBytes += Buffer.byteLength(loaded.instructions, "utf8");
      if (contextBytes > this.#limits.maxContextBytes) {
        throw new SkillOsError("DENIED", "Skill OS pack exceeds the context ceiling.");
      }
    }
    if (contextBytes !== sourceSummary.contextBytes) {
      throw new SkillOsError(
        "CONFLICT",
        "Pack member instruction bytes do not match source metadata.",
      );
    }

    const key = packKey(input.id, input.version);
    const existing = this.#packs.get(key);
    const normalized: RegisteredPack = Object.freeze({
      members: Object.freeze(input.members.map(cloneMember)),
      summary: freezeSummary(sourceSummary),
    });
    if (existing !== undefined) {
      if (stableHash(existing) === stableHash(normalized)) return existing.summary;
      throw new SkillOsError("CONFLICT", `Skill OS pack ${key} is already registered differently.`);
    }
    this.#packs.set(key, normalized);
    return cloneSummary(normalized.summary);
  }

  discover(value: unknown): readonly SkillOsPackSummary[] {
    const request = normalizeDiscovery(value, this.#limits);
    const maxContextBytes = request.maxContextBytes ?? this.#limits.maxContextBytes;
    return Object.freeze(
      [...this.#packs.values()]
        .filter(
          ({ summary }) =>
            summary.domain === request.domain &&
            summary.taskClasses.includes(request.taskClass) &&
            summary.contextBytes <= maxContextBytes,
        )
        .map(({ summary }) => cloneSummary(summary))
        .sort(
          (left, right) =>
            left.contextBytes - right.contextBytes ||
            left.memberCount - right.memberCount ||
            packKey(left.id, left.version).localeCompare(packKey(right.id, right.version)),
        ),
    );
  }

  select(value: unknown): SkillOsSelection {
    const request = normalizeSelection(value, this.#limits);
    const eligible = this.discover(request).filter(
      (summary) => summary.memberCount <= (request.maxMembers ?? this.#limits.maxMembers),
    );
    if (eligible.length === 0) {
      throw new SkillOsError("NOT_FOUND", "No registered capability pack satisfies this task.");
    }

    const pin = this.#pins.get(routeKey(request.domain, request.taskClass));
    let selected = eligible[0];
    if (pin !== undefined) {
      selected = eligible.find(
        (summary) =>
          summary.id === pin.packId &&
          summary.version === pin.packVersion &&
          summary.packHash === pin.packHash,
      );
      if (selected === undefined) {
        throw new SkillOsError("DENIED", "The pinned capability pack is no longer eligible.");
      }
    }
    if (selected === undefined) {
      throw new SkillOsError("NOT_FOUND", "No deterministic Skill OS selection was available.");
    }

    const issuedAt = canonicalNow(this.#clock());
    const body = {
      contextBytes: selected.contextBytes,
      domain: request.domain,
      issuedAt,
      memberCount: selected.memberCount,
      packHash: selected.packHash,
      packId: selected.id,
      packVersion: selected.version,
      taskClass: request.taskClass,
    } as const;
    return Object.freeze({ ...body, selectionHash: stableHash(body) });
  }

  load(value: unknown): SkillOsLoadedSelection {
    const selection = normalizeIssuedSelection(value);
    const nowMs = Date.parse(canonicalNow(this.#clock()));
    const issuedAtMs = Date.parse(selection.issuedAt);
    if (issuedAtMs > nowMs) {
      throw new SkillOsError("DENIED", "Skill OS selection was issued in the future.");
    }
    if (nowMs - issuedAtMs > this.#limits.maxSelectionAgeMs) {
      throw new SkillOsError("DENIED", "Skill OS selection is stale and must be reselected.");
    }
    const { selectionHash, ...body } = selection;
    if (selectionHash !== stableHash(body)) {
      throw new SkillOsError("CONFLICT", "Skill OS selection integrity check failed.");
    }
    const pack = this.#packs.get(packKey(selection.packId, selection.packVersion));
    if (pack === undefined)
      throw new SkillOsError("NOT_FOUND", "Selected capability pack is absent.");
    if (
      pack.summary.packHash !== selection.packHash ||
      pack.summary.domain !== selection.domain ||
      pack.summary.contextBytes !== selection.contextBytes ||
      pack.summary.memberCount !== selection.memberCount ||
      !pack.summary.taskClasses.includes(selection.taskClass)
    ) {
      throw new SkillOsError("CONFLICT", "Selection no longer matches registered pack identity.");
    }

    const packages: SkillPackage[] = [];
    let loadedBytes = 0;
    for (const member of pack.members) {
      if (!member.taskClasses.includes(selection.taskClass)) continue;
      const loaded = this.#source.resolveMember(
        selection.packId,
        selection.packVersion,
        member.name,
        member.version,
      );
      if (loaded.contentHash !== member.contentHash) {
        throw new SkillOsError("CONFLICT", "Selected member no longer matches its verified hash.");
      }
      loadedBytes += Buffer.byteLength(loaded.instructions, "utf8");
      if (loadedBytes > selection.contextBytes || packages.length + 1 > this.#limits.maxMembers) {
        throw new SkillOsError("DENIED", "Progressive skill loading exceeded its runtime ceiling.");
      }
      packages.push(clonePackage(loaded));
    }
    if (packages.length === 0) {
      throw new SkillOsError("DENIED", "Selected pack has no member for the requested task class.");
    }
    return Object.freeze({ packages: Object.freeze(packages), selection });
  }

  pin(value: unknown): SkillOsHistoryEvent {
    const request = normalizePin(value);
    const pack = this.#requirePinTarget(request);
    return this.#recordPin("PINNED", request, pack);
  }

  rollback(value: unknown): SkillOsHistoryEvent {
    const request = normalizePin(value) as SkillOsRollbackRequest;
    const pack = this.#requirePinTarget(request);
    const seenBefore = this.#history.some(
      (event) =>
        event.domain === request.domain &&
        event.taskClass === request.taskClass &&
        event.packId === request.packId &&
        event.packVersion === request.packVersion &&
        event.packHash === request.packHash,
    );
    if (!seenBefore) {
      throw new SkillOsError(
        "DENIED",
        "Rollback target was not previously pinned for this task route.",
      );
    }
    return this.#recordPin("ROLLED_BACK", request, pack);
  }

  history(): readonly SkillOsHistoryEvent[] {
    return Object.freeze(this.#history.map((event) => Object.freeze({ ...event })));
  }

  #requirePinTarget(request: SkillOsPinRequest): RegisteredPack {
    const pack = this.#packs.get(packKey(request.packId, request.packVersion));
    if (pack === undefined)
      throw new SkillOsError("NOT_FOUND", "Pinned capability pack is absent.");
    if (
      pack.summary.packHash !== request.packHash ||
      pack.summary.domain !== request.domain ||
      !pack.summary.taskClasses.includes(request.taskClass)
    ) {
      throw new SkillOsError(
        "CONFLICT",
        "Pin target does not match the exact pack route identity.",
      );
    }
    return pack;
  }

  #recordPin(
    action: SkillOsHistoryEvent["action"],
    request: SkillOsPinRequest,
    _pack: RegisteredPack,
  ): SkillOsHistoryEvent {
    const event = Object.freeze({
      action,
      actor: request.actor,
      domain: request.domain,
      occurredAt: canonicalNow(this.#clock()),
      packHash: request.packHash,
      packId: request.packId,
      packVersion: request.packVersion,
      sequence: this.#history.length + 1,
      taskClass: request.taskClass,
    });
    this.#history.push(event);
    this.#pins.set(routeKey(request.domain, request.taskClass), event);
    return Object.freeze({ ...event });
  }
}

function normalizeLimits(value: SkillOsLimits): SkillOsLimits {
  for (const [name, amount] of Object.entries(value)) {
    if (!Number.isSafeInteger(amount) || amount < 1) {
      throw new SkillOsError("INVALID_INPUT", `${name} must be a positive safe integer.`);
    }
  }
  return Object.freeze({ ...value });
}

function normalizeRegistration(value: unknown, limits: SkillOsLimits): SkillOsPackRegistration {
  const object = exactObject(value, [
    "contextBytes",
    "domain",
    "id",
    "memberCount",
    "members",
    "packHash",
    "taskClasses",
    "version",
  ]);
  const summary = normalizeSummary(object, limits);
  if (!Array.isArray(object.members) || object.members.length !== summary.memberCount) {
    invalid("Pack members must match memberCount.");
  }
  const members = object.members.map((member) => normalizeMember(member, limits));
  const keys = members.map((member) => `${member.name}@${member.version}`);
  if (new Set(keys).size !== keys.length) invalid("Pack members must be unique.");
  return Object.freeze({ ...summary, members: Object.freeze(members.sort(memberOrder)) });
}

function normalizeSummary(value: unknown, limits: SkillOsLimits): SkillOsPackSummary {
  const object = value as Record<string, unknown>;
  const domain = object.domain;
  if (typeof domain !== "string" || !DOMAINS.has(domain as CapabilityDomain))
    invalid("Pack domain is invalid.");
  const id = identifier(object.id, "pack id");
  const version = identifier(object.version, "pack version");
  const packHash = sha256(object.packHash, "pack hash");
  const contextBytes = positiveBounded(object.contextBytes, limits.maxContextBytes, "contextBytes");
  const memberCount = positiveBounded(object.memberCount, limits.maxMembers, "memberCount");
  const taskClasses = strings(object.taskClasses, limits.maxTaskClasses, "taskClasses");
  return Object.freeze({
    contextBytes,
    domain: domain as CapabilityDomain,
    id,
    memberCount,
    packHash,
    taskClasses,
    version,
  });
}

function normalizeMember(value: unknown, limits: SkillOsLimits): SkillOsPackMemberRef {
  const object = exactObject(value, ["contentHash", "name", "taskClasses", "version"]);
  return Object.freeze({
    contentHash: sha256(object.contentHash, "member content hash"),
    name: identifier(object.name, "member name"),
    taskClasses: strings(object.taskClasses, limits.maxTaskClasses, "member taskClasses"),
    version: identifier(object.version, "member version"),
  });
}

function normalizeDiscovery(value: unknown, limits: SkillOsLimits): SkillOsDiscoveryRequest {
  const object = exactObject(
    value,
    ["domain", "maxContextBytes", "taskClass"],
    ["maxContextBytes"],
  );
  const domain = object.domain;
  if (typeof domain !== "string" || !DOMAINS.has(domain as CapabilityDomain))
    invalid("Discovery domain is invalid.");
  const request: SkillOsDiscoveryRequest = {
    domain: domain as CapabilityDomain,
    taskClass: identifier(object.taskClass, "taskClass"),
    ...(object.maxContextBytes === undefined
      ? {}
      : {
          maxContextBytes: positiveBounded(
            object.maxContextBytes,
            limits.maxContextBytes,
            "maxContextBytes",
          ),
        }),
  };
  return Object.freeze(request);
}

function normalizeSelection(value: unknown, limits: SkillOsLimits): SkillOsSelectionRequest {
  const object = exactObject(
    value,
    ["domain", "maxContextBytes", "maxMembers", "taskClass"],
    ["maxContextBytes", "maxMembers"],
  );
  const discovery = normalizeDiscovery(
    {
      domain: object.domain,
      taskClass: object.taskClass,
      ...(object.maxContextBytes === undefined ? {} : { maxContextBytes: object.maxContextBytes }),
    },
    limits,
  );
  return Object.freeze({
    ...discovery,
    ...(object.maxMembers === undefined
      ? {}
      : { maxMembers: positiveBounded(object.maxMembers, limits.maxMembers, "maxMembers") }),
  });
}

function normalizeIssuedSelection(value: unknown): SkillOsSelection {
  const object = exactObject(value, [
    "contextBytes",
    "domain",
    "issuedAt",
    "memberCount",
    "packHash",
    "packId",
    "packVersion",
    "selectionHash",
    "taskClass",
  ]);
  const domain = object.domain;
  if (typeof domain !== "string" || !DOMAINS.has(domain as CapabilityDomain))
    invalid("Selection domain is invalid.");
  return Object.freeze({
    contextBytes: positiveBounded(
      object.contextBytes,
      Number.MAX_SAFE_INTEGER,
      "selection contextBytes",
    ),
    domain: domain as CapabilityDomain,
    issuedAt: canonicalTimestamp(object.issuedAt, "selection issuedAt"),
    memberCount: positiveBounded(
      object.memberCount,
      Number.MAX_SAFE_INTEGER,
      "selection memberCount",
    ),
    packHash: sha256(object.packHash, "selection packHash"),
    packId: identifier(object.packId, "selection packId"),
    packVersion: identifier(object.packVersion, "selection packVersion"),
    selectionHash: sha256(object.selectionHash, "selectionHash"),
    taskClass: identifier(object.taskClass, "selection taskClass"),
  });
}

function normalizePin(value: unknown): SkillOsPinRequest {
  const object = exactObject(value, [
    "actor",
    "domain",
    "packHash",
    "packId",
    "packVersion",
    "taskClass",
  ]);
  if (object.actor !== "trusted_runtime" && object.actor !== "user_approved")
    invalid("Pin actor is invalid.");
  const domain = object.domain;
  if (typeof domain !== "string" || !DOMAINS.has(domain as CapabilityDomain))
    invalid("Pin domain is invalid.");
  return Object.freeze({
    actor: object.actor,
    domain: domain as CapabilityDomain,
    packHash: sha256(object.packHash, "pin packHash"),
    packId: identifier(object.packId, "pin packId"),
    packVersion: identifier(object.packVersion, "pin packVersion"),
    taskClass: identifier(object.taskClass, "pin taskClass"),
  });
}

function assertSummaryMatches(input: SkillOsPackRegistration, source: SkillOsPackSummary): void {
  if (
    input.packHash !== source.packHash ||
    input.domain !== source.domain ||
    input.contextBytes !== source.contextBytes ||
    input.memberCount !== source.memberCount ||
    !equalStrings(input.taskClasses, source.taskClasses)
  ) {
    throw new SkillOsError(
      "CONFLICT",
      "Skill OS registration does not match trusted pack metadata.",
    );
  }
}

function exactObject(
  value: unknown,
  allowed: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    invalid("Expected an object.");
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  const allowedSet = new Set(allowed);
  if (keys.some((key) => !allowedSet.has(key))) invalid("Object contains unknown fields.");
  const optionalSet = new Set(optional);
  for (const key of allowed) {
    if (!optionalSet.has(key) && !(key in object)) invalid(`Object is missing ${key}.`);
  }
  return object;
}

function strings(value: unknown, max: number, name: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max)
    invalid(`${name} is malformed.`);
  const normalized = value.map((item) => identifier(item, name)).sort();
  if (new Set(normalized).size !== normalized.length) invalid(`${name} contains duplicates.`);
  return Object.freeze(normalized);
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/u.test(value))
    invalid(`${name} is invalid.`);
  return value;
}

function sha256(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    invalid(`${name} must be SHA-256.`);
  return value;
}

function positiveBounded(value: unknown, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max)
    invalid(`${name} is outside its ceiling.`);
  return value as number;
}

function canonicalTimestamp(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    invalid(`${name} must be canonical UTC.`);
  return value;
}

function canonicalNow(value: string): string {
  return canonicalTimestamp(value, "runtime clock");
}

function cloneMember(member: SkillOsPackMemberRef): SkillOsPackMemberRef {
  return Object.freeze({ ...member, taskClasses: Object.freeze([...member.taskClasses]) });
}

function cloneSummary(summary: SkillOsPackSummary): SkillOsPackSummary {
  return Object.freeze({ ...summary, taskClasses: Object.freeze([...summary.taskClasses]) });
}

function freezeSummary(summary: SkillOsPackSummary): SkillOsPackSummary {
  return cloneSummary(summary);
}

function clonePackage(skill: SkillPackage): SkillPackage {
  return structuredClone(skill);
}

function memberOrder(left: SkillOsPackMemberRef, right: SkillOsPackMemberRef): number {
  return `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`);
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

function packKey(id: string, version: string): string {
  return `${id}@${version}`;
}

function routeKey(domain: CapabilityDomain, taskClass: string): string {
  return `${domain}\u0000${taskClass}`;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function invalid(message: string): never {
  throw new SkillOsError("INVALID_INPUT", message);
}
