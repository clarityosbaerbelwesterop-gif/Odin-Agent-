import { createHash } from "node:crypto";
import type {
  CompiledContext,
  CompiledContextItem,
  CompiledContextSection,
  ContextBudget,
  ContextCandidate,
  ContextCompileRequest,
  ContextDropReason,
  ContextPriority,
  ContextSensitivity,
  ContextSourceClass,
  DroppedContextItem,
} from "./types.js";

const PRIORITIES = ["P0", "P1", "P2", "P3", "P4", "P5", "P6"] as const;
const REQUIRED_PRIORITIES = new Set<ContextPriority>(["P0", "P1", "P2"]);
const PRIORITY_INDEX = new Map<ContextPriority, number>(
  PRIORITIES.map((priority, index) => [priority, index]),
);
const SOURCE_PRIORITY: Readonly<Record<ContextSourceClass, ContextPriority>> = {
  history: "P6",
  memory: "P5",
  mission: "P1",
  observation: "P4",
  repository: "P3",
  system: "P0",
  task: "P2",
};
const SOURCE_CLASSES = new Set<ContextSourceClass>(
  Object.keys(SOURCE_PRIORITY) as ContextSourceClass[],
);
const SENSITIVITIES = new Set<ContextSensitivity>(["internal", "public", "sensitive"]);
const MAX_CANDIDATES = 256;
const MAX_CONTENT_LENGTH = 65_536;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_REFERENCE_LENGTH = 1_000;
const MAX_TOKEN_BUDGET = 10_000_000;
const ITEM_OVERHEAD_TOKENS = 8;

interface CacheRecord {
  readonly result: CompiledContext;
  readonly sourceIds: readonly string[];
}

export class ContextBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextBudgetError";
  }
}

export class ContextCompilationCache {
  readonly #entries = new Map<string, CacheRecord>();
  #hits = 0;

  constructor(readonly maxEntries = 128) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 10_000) {
      throw new TypeError("Context cache maxEntries must be an integer from 1 to 10000.");
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  get hits(): number {
    return this.#hits;
  }

  get(key: string): CompiledContext | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    this.#hits += 1;
    return { ...structuredClone(entry.result), cacheHit: true };
  }

  set(key: string, result: CompiledContext, sourceIds: readonly string[]): void {
    if (this.#entries.has(key)) return;
    while (this.#entries.size >= this.maxEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    this.#entries.set(key, {
      result: structuredClone(result),
      sourceIds: [...sourceIds],
    });
  }

  invalidateSource(sourceId: string): number {
    let invalidated = 0;
    for (const [key, entry] of this.#entries) {
      if (entry.sourceIds.includes(sourceId)) {
        this.#entries.delete(key);
        invalidated += 1;
      }
    }
    return invalidated;
  }
}

export class DeterministicContextCompiler {
  readonly #sourceFingerprints = new Map<string, string>();

  constructor(readonly cache = new ContextCompilationCache()) {}

  compile(request: ContextCompileRequest): CompiledContext {
    const normalized = validateAndNormalize(request);
    this.#invalidateChangedSources(normalized.candidates);
    const cacheable = normalized.candidates.every(
      (candidate) => candidate.sensitivity !== "sensitive",
    );
    const cacheKey = stableHash(normalized);
    if (cacheable) {
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) return cached;
    }

    const sourceFingerprint = stableHash(
      normalized.candidates.map((candidate) => ({
        contentHash: candidate.source.contentHash,
        id: candidate.id,
        observedAt: candidate.source.observedAt,
        reference: candidate.source.reference,
        version: candidate.source.version,
      })),
    );
    const { candidates, duplicateDrops } = removeOptionalDuplicates(normalized.candidates);
    const selected: CompiledContextItem[] = [];
    const dropped: DroppedContextItem[] = [...duplicateDrops];
    const sectionTotals = new Map<ContextPriority, number>(PRIORITIES.map((value) => [value, 0]));
    let total = 0;

    for (const candidate of candidates) {
      const estimatedTokens = estimateTokens(candidate.content);
      const priorityTotal = sectionTotals.get(candidate.priority) ?? 0;
      const isRequired = REQUIRED_PRIORITIES.has(candidate.priority);
      const reason = overBudgetReason(
        estimatedTokens,
        priorityTotal,
        total,
        candidate.priority,
        normalized.budget,
      );
      if (reason !== undefined) {
        if (isRequired) {
          throw new ContextBudgetError(
            `Required ${candidate.priority} context '${candidate.id}' exceeds ${reason}.`,
          );
        }
        dropped.push({ id: candidate.id, reason });
        continue;
      }
      selected.push({ ...candidate, estimatedTokens });
      sectionTotals.set(candidate.priority, priorityTotal + estimatedTokens);
      total += estimatedTokens;
    }

    for (const priority of REQUIRED_PRIORITIES) {
      if (!selected.some((candidate) => candidate.priority === priority)) {
        throw new ContextBudgetError(`Required context section ${priority} is missing.`);
      }
    }

    const sections = buildSections(selected);
    const resultWithoutHash = {
      cacheHit: false,
      dropped: sortDrops(dropped),
      estimatedTokens: total,
      missionId: normalized.missionId,
      policyVersion: normalized.policyVersion,
      schemaVersion: 1 as const,
      sections,
      selectedIds: selected.map((candidate) => candidate.id),
      sourceFingerprint,
      taskId: normalized.taskId,
      tokenEstimateMethod: "utf8-bytes-divided-by-3-plus-overhead-v1" as const,
    };
    const result: CompiledContext = {
      ...resultWithoutHash,
      resultHash: stableHash({ ...resultWithoutHash, cacheHit: undefined }),
    };
    if (cacheable) {
      this.cache.set(
        cacheKey,
        result,
        normalized.candidates.map((candidate) => candidate.id),
      );
    }
    return structuredClone(result);
  }

  invalidateSource(sourceId: string): number {
    this.#sourceFingerprints.delete(sourceId);
    return this.cache.invalidateSource(sourceId);
  }

  #invalidateChangedSources(candidates: readonly ContextCandidate[]): void {
    for (const candidate of candidates) {
      const fingerprint = stableHash({
        contentHash: candidate.source.contentHash,
        observedAt: candidate.source.observedAt,
        reference: candidate.source.reference,
        version: candidate.source.version,
      });
      const previous = this.#sourceFingerprints.get(candidate.id);
      if (previous !== undefined && previous !== fingerprint) {
        this.cache.invalidateSource(candidate.id);
      }
      this.#sourceFingerprints.set(candidate.id, fingerprint);
    }
  }
}

function validateAndNormalize(request: ContextCompileRequest): ContextCompileRequest {
  assertIdentifier(request.missionId, "missionId");
  assertIdentifier(request.taskId, "taskId");
  assertIdentifier(request.policyVersion, "policyVersion");
  validateBudget(request.budget);
  if (request.candidates.length > MAX_CANDIDATES) {
    throw new TypeError(`Context candidates are limited to ${MAX_CANDIDATES} items.`);
  }
  const ids = new Set<string>();
  const candidates = request.candidates.map((candidate) => {
    validateCandidate(candidate);
    if (ids.has(candidate.id))
      throw new TypeError(`Duplicate context candidate ID '${candidate.id}'.`);
    ids.add(candidate.id);
    return structuredClone(candidate);
  });
  candidates.sort(compareCandidates);
  return {
    budget: structuredClone(request.budget),
    candidates,
    missionId: request.missionId,
    policyVersion: request.policyVersion,
    taskId: request.taskId,
  };
}

function validateCandidate(candidate: ContextCandidate): void {
  assertIdentifier(candidate.id, "candidate.id");
  assertIdentifier(candidate.semanticKey, "candidate.semanticKey");
  if (!PRIORITY_INDEX.has(candidate.priority)) throw new TypeError("Unsupported context priority.");
  if (
    !Number.isSafeInteger(candidate.relevance) ||
    candidate.relevance < 0 ||
    candidate.relevance > 100
  ) {
    throw new TypeError("candidate.relevance must be an integer from 0 to 100.");
  }
  if (!SENSITIVITIES.has(candidate.sensitivity)) {
    throw new TypeError("Unsupported context sensitivity.");
  }
  if (candidate.content.trim() === "" || candidate.content.length > MAX_CONTENT_LENGTH) {
    throw new TypeError(`candidate.content must contain 1-${MAX_CONTENT_LENGTH} characters.`);
  }
  if (!SOURCE_CLASSES.has(candidate.source.class)) {
    throw new TypeError("Unsupported context source class.");
  }
  if (SOURCE_PRIORITY[candidate.source.class] !== candidate.priority) {
    throw new TypeError(
      `Context source '${candidate.source.class}' must use ${SOURCE_PRIORITY[candidate.source.class]}.`,
    );
  }
  assertText(candidate.source.reference, "candidate.source.reference", MAX_REFERENCE_LENGTH);
  assertIdentifier(candidate.source.version, "candidate.source.version");
  assertCanonicalTimestamp(candidate.source.observedAt, "candidate.source.observedAt");
  if (!/^[a-f0-9]{64}$/u.test(candidate.source.contentHash)) {
    throw new TypeError("candidate.source.contentHash must be a lowercase SHA-256 digest.");
  }
  if (sha256(candidate.content) !== candidate.source.contentHash) {
    throw new TypeError("candidate.source.contentHash does not match candidate.content.");
  }
}

function validateBudget(budget: ContextBudget): void {
  assertTokenLimit(budget.totalTokens, "budget.totalTokens");
  assertTokenLimit(budget.maxItemTokens, "budget.maxItemTokens");
  for (const priority of PRIORITIES) {
    assertTokenLimit(budget.perPriority[priority], `budget.perPriority.${priority}`);
    if (budget.perPriority[priority] > budget.totalTokens) {
      throw new TypeError(`budget.perPriority.${priority} cannot exceed the total budget.`);
    }
  }
}

function removeOptionalDuplicates(candidates: readonly ContextCandidate[]): {
  readonly candidates: readonly ContextCandidate[];
  readonly duplicateDrops: readonly DroppedContextItem[];
} {
  const retained: ContextCandidate[] = [];
  const dropped: DroppedContextItem[] = [];
  const optionalWinners = new Map<string, ContextCandidate>();

  for (const candidate of candidates) {
    if (REQUIRED_PRIORITIES.has(candidate.priority)) {
      retained.push(candidate);
      continue;
    }
    const winner = optionalWinners.get(candidate.semanticKey);
    if (winner === undefined) {
      optionalWinners.set(candidate.semanticKey, candidate);
    } else {
      dropped.push({ id: candidate.id, reason: "duplicate" });
    }
  }

  const requiredKeys = new Set(retained.map((candidate) => candidate.semanticKey));
  for (const candidate of optionalWinners.values()) {
    if (requiredKeys.has(candidate.semanticKey)) {
      dropped.push({ id: candidate.id, reason: "duplicate" });
    } else {
      retained.push(candidate);
    }
  }
  retained.sort(compareCandidates);
  return { candidates: retained, duplicateDrops: sortDrops(dropped) };
}

function compareCandidates(left: ContextCandidate, right: ContextCandidate): number {
  return (
    priorityIndex(left.priority) - priorityIndex(right.priority) ||
    right.relevance - left.relevance ||
    right.source.observedAt.localeCompare(left.source.observedAt) ||
    left.id.localeCompare(right.id)
  );
}

function overBudgetReason(
  itemTokens: number,
  sectionTokens: number,
  totalTokens: number,
  priority: ContextPriority,
  budget: ContextBudget,
): ContextDropReason | undefined {
  if (itemTokens > budget.maxItemTokens) return "item_limit";
  if (sectionTokens + itemTokens > budget.perPriority[priority]) return "section_budget";
  if (totalTokens + itemTokens > budget.totalTokens) return "total_budget";
  return undefined;
}

function buildSections(items: readonly CompiledContextItem[]): CompiledContextSection[] {
  return PRIORITIES.map((priority) => {
    const sectionItems = items.filter((item) => item.priority === priority);
    return {
      estimatedTokens: sectionItems.reduce((total, item) => total + item.estimatedTokens, 0),
      items: sectionItems,
      priority,
    };
  }).filter((section) => section.items.length > 0);
}

function sortDrops(dropped: readonly DroppedContextItem[]): DroppedContextItem[] {
  return [...dropped].sort(
    (left, right) => left.id.localeCompare(right.id) || left.reason.localeCompare(right.reason),
  );
}

function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(content, "utf8") / 3)) + ITEM_OVERHEAD_TOKENS;
}

function priorityIndex(priority: ContextPriority): number {
  const index = PRIORITY_INDEX.get(priority);
  if (index === undefined) throw new TypeError("Unsupported context priority.");
  return index;
}

function assertTokenLimit(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TOKEN_BUDGET) {
    throw new TypeError(`${name} must be an integer from 1 to ${MAX_TOKEN_BUDGET}.`);
  }
}

function assertIdentifier(value: string, name: string): void {
  assertText(value, name, MAX_IDENTIFIER_LENGTH);
  if (value.includes("\u0000")) throw new TypeError(`${name} must not contain a null character.`);
}

function assertText(value: string, name: string, maximum: number): void {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum) {
    throw new TypeError(`${name} must contain 1-${maximum} characters.`);
  }
}

function assertCanonicalTimestamp(value: string, name: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new TypeError(`${name} must be a canonical UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(`${name} must be a valid canonical UTC timestamp.`);
  }
  return parsed;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableHash(value: unknown): string {
  const encoded = JSON.stringify(canonicalize(value));
  if (encoded === undefined) throw new TypeError("Cannot hash an undefined context value.");
  return sha256(encoded);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .filter((key) => object[key] !== undefined)
      .map((key) => [key, canonicalize(object[key])]),
  );
}
