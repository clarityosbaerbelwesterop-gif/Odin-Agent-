import { createHash } from "node:crypto";
import type { MemoryConflictGroup } from "./advanced.js";
import type { ActiveMemoryRecord, MemorySourceClass, StoredMemoryRecord } from "./types.js";

export type MemoryProductStatus =
  | "ACTIVE"
  | "TEMPORARY"
  | "STALE"
  | "CONFLICTED"
  | "SUPERSEDED"
  | "NOISE_CANDIDATE"
  | "ARCHIVED";
export type MemoryConfidence = "high" | "medium" | "low";
export type MemoryBrainNodeClass =
  | "MEMORY"
  | "PROJECT"
  | "WORKSPACE_SOURCE"
  | "DOCUMENT"
  | "ARTIFACT"
  | "RUN"
  | "SOURCE";

export interface MemoryProductSignal {
  readonly id: string;
  readonly usageCount: number;
  readonly lastUsedAt: string | null;
  readonly pinned: boolean;
  readonly archivedAt: string | null;
}

export interface MemorySourceProjection {
  readonly reference: string;
  readonly title: string;
  readonly nodeClass: Exclude<MemoryBrainNodeClass, "MEMORY" | "PROJECT">;
}

export interface MemoryBrainPulse {
  readonly turnId: string;
  readonly selectedMemoryIds: readonly string[];
  readonly selectedWorkspaceReferences: readonly string[];
  readonly contextResultHash: string;
  readonly at: string;
  readonly dropped: readonly { readonly id: string; readonly reason: string }[];
}

export interface MemoryBrainNode {
  readonly id: string;
  readonly nodeClass: MemoryBrainNodeClass;
  readonly title: string;
  readonly status?: MemoryProductStatus;
  readonly memoryKind?: ActiveMemoryRecord["kind"];
  readonly summary?: string;
  readonly importance?: number;
  readonly confidence?: MemoryConfidence;
  readonly sensitivity?: ActiveMemoryRecord["sensitivity"];
  readonly sourceClass?: MemorySourceClass;
  readonly sourceReference?: string;
  readonly sourceVersion?: string;
  readonly sourceObservedAt?: string;
  readonly updatedAt?: string;
  readonly expiresAt?: string;
  readonly version?: number;
  readonly recordHash?: string;
  readonly tags?: readonly string[];
  readonly usageCount?: number;
  readonly lastUsedAt?: string | null;
  readonly pinned?: boolean;
  readonly mergedCount?: number;
  readonly activeInContext?: boolean;
}

export interface MemoryBrainEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly relation: "contains" | "sourced_from" | "related" | "supersedes";
}

export interface MemoryBrainProjection {
  readonly projectId: string;
  readonly evaluatedAt: string;
  readonly nodes: readonly MemoryBrainNode[];
  readonly edges: readonly MemoryBrainEdge[];
  readonly counts: Readonly<Record<MemoryProductStatus, number>>;
  readonly pulse: MemoryBrainPulse | null;
  readonly truncated: boolean;
  readonly projectionHash: string;
}

export interface MemoryBrainProjectionInput {
  readonly projectId: string;
  readonly projectTitle: string;
  readonly evaluatedAt: string;
  readonly records: readonly StoredMemoryRecord[];
  readonly staleIds?: readonly string[];
  readonly conflicts?: readonly MemoryConflictGroup[];
  readonly signals?: readonly MemoryProductSignal[];
  readonly sources?: readonly MemorySourceProjection[];
  readonly pulse?: MemoryBrainPulse | null;
  readonly filters?: {
    readonly text?: string;
    readonly kinds?: readonly ActiveMemoryRecord["kind"][];
    readonly statuses?: readonly MemoryProductStatus[];
    readonly sourceClasses?: readonly MemorySourceClass[];
  };
  readonly maxMemoryNodes?: number;
}

const SOURCE_WEIGHT: Readonly<Record<MemorySourceClass, number>> = {
  explicit_user: 34,
  verified_learning: 30,
  repository: 27,
  tool: 24,
  import: 17,
  model_summary: 12,
};

export function projectMemoryBrain(input: MemoryBrainProjectionInput): MemoryBrainProjection {
  const evaluatedAt = canonicalTime(input.evaluatedAt);
  const evaluatedAtMs = Date.parse(evaluatedAt);
  const stale = new Set(input.staleIds ?? []);
  const conflicts = new Set((input.conflicts ?? []).flatMap((group) => group.recordIds));
  const signalById = new Map(
    (input.signals ?? []).map((signal) => [signal.id, validateSignal(signal)]),
  );
  const sourceByReference = new Map(
    (input.sources ?? []).map((source) => [source.reference, source]),
  );
  const pulse = input.pulse ?? null;
  const pulseIds = new Set(pulse?.selectedMemoryIds ?? []);
  const superseded = duplicateSupersededIds(input.records);
  const mergedCounts = duplicateMergedCounts(input.records);
  const maxMemoryNodes = Math.max(1, Math.min(160, input.maxMemoryNodes ?? 120));

  const projected = input.records
    .map((record) => {
      const signal = signalById.get(record.id) ?? emptySignal(record.id);
      if (record.status === "tombstoned") return tombstoneNode(record, signal);
      const status = statusFor(record, signal, {
        stale: stale.has(record.id),
        conflicted: conflicts.has(record.id),
        superseded: superseded.has(record.id),
        evaluatedAtMs,
      });
      return activeNode(
        record,
        signal,
        status,
        mergedCounts.get(record.id) ?? 1,
        pulseIds.has(record.id),
        evaluatedAtMs,
      );
    })
    .filter((node) => matchesFilters(node, input.filters))
    .sort(compareNodes);

  const keptMemory = projected.slice(0, maxMemoryNodes);
  const keptIds = new Set(keptMemory.map((node) => node.id));
  const nodes: MemoryBrainNode[] = [
    { id: `project:${input.projectId}`, nodeClass: "PROJECT", title: input.projectTitle },
    ...keptMemory,
  ];
  const edges: MemoryBrainEdge[] = [];
  const sourceNodeIds = new Map<string, string>();

  for (const node of keptMemory) {
    edges.push(edge(`project:${input.projectId}`, node.id, "contains"));
    if (!node.sourceReference) continue;
    const source = sourceByReference.get(node.sourceReference);
    const sourceId =
      sourceNodeIds.get(node.sourceReference) ?? `source:${sha(node.sourceReference).slice(0, 20)}`;
    if (!sourceNodeIds.has(node.sourceReference)) {
      sourceNodeIds.set(node.sourceReference, sourceId);
      nodes.push({
        id: sourceId,
        nodeClass: source?.nodeClass ?? classifySource(node.sourceReference),
        title: source?.title ?? sourceTitle(node.sourceReference),
        activeInContext: pulse?.selectedWorkspaceReferences.includes(node.sourceReference) ?? false,
      });
    }
    edges.push(edge(node.id, sourceId, "sourced_from"));
  }

  addSupersessionEdges(keptMemory, edges);
  addTagEdges(keptMemory, keptIds, edges);
  const counts = emptyCounts();
  for (const node of keptMemory) if (node.status) counts[node.status] += 1;

  const body = {
    projectId: input.projectId,
    evaluatedAt,
    nodes,
    edges,
    counts,
    pulse,
    truncated: projected.length > keptMemory.length,
  };
  return Object.freeze({ ...structuredClone(body), projectionHash: stableHash(body) });
}

export function isMemoryNoiseCandidate(
  record: ActiveMemoryRecord,
  signal: MemoryProductSignal,
  evaluatedAt: string,
): boolean {
  const evaluatedAtMs = Date.parse(canonicalTime(evaluatedAt));
  if (signal.pinned || signal.usageCount > 0) return false;
  if (record.expiresAt !== undefined && Date.parse(record.expiresAt) <= evaluatedAtMs) return true;
  const age = evaluatedAtMs - Date.parse(record.updatedAt);
  if (record.kind === "episodic" && age > 30 * 86_400_000) return true;
  return record.provenance.sourceClass === "model_summary" && age > 90 * 86_400_000;
}

function tombstoneNode(
  record: Extract<StoredMemoryRecord, { status: "tombstoned" }>,
  signal: MemoryProductSignal,
): MemoryBrainNode {
  return {
    id: record.id,
    nodeClass: "MEMORY",
    title: "Archived memory",
    status: "ARCHIVED",
    summary: "Content removed; revision history and tombstone remain auditable.",
    importance: 0,
    confidence: "low",
    updatedAt: record.updatedAt,
    version: record.version,
    recordHash: record.recordHash,
    usageCount: signal.usageCount,
    lastUsedAt: signal.lastUsedAt,
    pinned: signal.pinned,
    mergedCount: 1,
    activeInContext: false,
  };
}

function activeNode(
  record: ActiveMemoryRecord,
  signal: MemoryProductSignal,
  status: MemoryProductStatus,
  mergedCount: number,
  activeInContext: boolean,
  evaluatedAtMs: number,
): MemoryBrainNode {
  return {
    id: record.id,
    nodeClass: "MEMORY",
    title: record.key,
    status,
    memoryKind: record.kind,
    summary:
      record.sensitivity === "sensitive"
        ? "Sensitive memory · content hidden in the graph projection."
        : summarize(record.content),
    importance: importanceFor(record, signal, status, evaluatedAtMs),
    confidence: confidenceFor(record.provenance.sourceClass, status),
    sensitivity: record.sensitivity,
    sourceClass: record.provenance.sourceClass,
    sourceReference: record.provenance.reference,
    sourceVersion: record.provenance.sourceVersion,
    sourceObservedAt: record.provenance.observedAt,
    updatedAt: record.updatedAt,
    ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
    version: record.version,
    recordHash: record.recordHash,
    tags: record.tags,
    usageCount: signal.usageCount,
    lastUsedAt: signal.lastUsedAt,
    pinned: signal.pinned,
    mergedCount,
    activeInContext,
  };
}

function statusFor(
  record: ActiveMemoryRecord,
  signal: MemoryProductSignal,
  flags: {
    stale: boolean;
    conflicted: boolean;
    superseded: boolean;
    evaluatedAtMs: number;
  },
): MemoryProductStatus {
  if (signal.archivedAt) return "ARCHIVED";
  if (flags.conflicted) return "CONFLICTED";
  if (flags.stale) return "STALE";
  if (flags.superseded) return "SUPERSEDED";
  const evaluatedAt = new Date(flags.evaluatedAtMs).toISOString();
  if (isMemoryNoiseCandidate(record, signal, evaluatedAt)) return "NOISE_CANDIDATE";
  if (record.kind === "working" || record.expiresAt !== undefined) return "TEMPORARY";
  return "ACTIVE";
}

function duplicateGroups(
  records: readonly StoredMemoryRecord[],
): Map<string, ActiveMemoryRecord[]> {
  const groups = new Map<string, ActiveMemoryRecord[]>();
  for (const record of records) {
    if (record.status !== "active") continue;
    const key = `${record.key}\u0000${record.provenance.contentHash}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return groups;
}

function orderedGroup(group: readonly ActiveMemoryRecord[]): ActiveMemoryRecord[] {
  return [...group].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
  );
}

function duplicateSupersededIds(records: readonly StoredMemoryRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const group of duplicateGroups(records).values()) {
    for (const record of orderedGroup(group).slice(1)) ids.add(record.id);
  }
  return ids;
}

function duplicateMergedCounts(records: readonly StoredMemoryRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of duplicateGroups(records).values()) {
    const current = orderedGroup(group)[0];
    if (current) counts.set(current.id, group.length);
  }
  return counts;
}

function addSupersessionEdges(nodes: readonly MemoryBrainNode[], edges: MemoryBrainEdge[]): void {
  const byKey = new Map<string, MemoryBrainNode[]>();
  for (const node of nodes) {
    const group = byKey.get(node.title) ?? [];
    group.push(node);
    byKey.set(node.title, group);
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((left, right) =>
      String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")),
    );
    const current = ordered[0];
    if (!current) continue;
    for (const older of ordered.slice(1)) {
      if (edges.length >= 320) return;
      edges.push(edge(current.id, older.id, "supersedes"));
    }
  }
}

function addTagEdges(
  nodes: readonly MemoryBrainNode[],
  keptIds: ReadonlySet<string>,
  edges: MemoryBrainEdge[],
): void {
  const tagOwner = new Map<string, string>();
  for (const node of nodes) {
    for (const tag of node.tags ?? []) {
      const existing = tagOwner.get(tag);
      if (existing && existing !== node.id && keptIds.has(existing) && edges.length < 320) {
        edges.push(edge(existing, node.id, "related"));
      } else if (!existing) {
        tagOwner.set(tag, node.id);
      }
    }
  }
}

function compareNodes(left: MemoryBrainNode, right: MemoryBrainNode): number {
  return (
    Number(right.activeInContext) - Number(left.activeInContext) ||
    warningRank(right.status) - warningRank(left.status) ||
    (right.importance ?? 0) - (left.importance ?? 0) ||
    String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")) ||
    left.id.localeCompare(right.id)
  );
}

function importanceFor(
  record: ActiveMemoryRecord,
  signal: MemoryProductSignal,
  status: MemoryProductStatus,
  evaluatedAtMs: number,
): number {
  const ageDays = Math.max(0, (evaluatedAtMs - Date.parse(record.updatedAt)) / 86_400_000);
  const recency = Math.max(0, 25 - Math.min(25, Math.floor(ageDays / 4)));
  const usage = Math.min(18, Math.floor(Math.log2(signal.usageCount + 1) * 5));
  const pinned = signal.pinned ? 22 : 0;
  const penalty =
    status === "CONFLICTED"
      ? 22
      : status === "STALE" || status === "SUPERSEDED"
        ? 28
        : status === "NOISE_CANDIDATE" || status === "ARCHIVED"
          ? 42
          : 0;
  return clamp(SOURCE_WEIGHT[record.provenance.sourceClass] + recency + usage + pinned - penalty);
}

function confidenceFor(source: MemorySourceClass, status: MemoryProductStatus): MemoryConfidence {
  if (["CONFLICTED", "STALE", "NOISE_CANDIDATE", "SUPERSEDED", "ARCHIVED"].includes(status))
    return "low";
  if (["explicit_user", "verified_learning", "repository", "tool"].includes(source)) return "high";
  return source === "import" ? "medium" : "low";
}

function matchesFilters(
  node: MemoryBrainNode,
  filters: MemoryBrainProjectionInput["filters"],
): boolean {
  if (!filters) return true;
  if (filters.kinds?.length && (!node.memoryKind || !filters.kinds.includes(node.memoryKind)))
    return false;
  if (filters.statuses?.length && (!node.status || !filters.statuses.includes(node.status)))
    return false;
  if (
    filters.sourceClasses?.length &&
    (!node.sourceClass || !filters.sourceClasses.includes(node.sourceClass))
  )
    return false;
  const text = filters.text?.trim().toLocaleLowerCase("en-US") ?? "";
  if (!text) return true;
  return [node.title, node.summary ?? "", ...(node.tags ?? [])]
    .join(" ")
    .toLocaleLowerCase("en-US")
    .includes(text);
}

function warningRank(status?: MemoryProductStatus): number {
  if (status === "CONFLICTED") return 4;
  if (status === "STALE") return 3;
  if (status === "NOISE_CANDIDATE") return 2;
  if (status === "SUPERSEDED") return 1;
  return 0;
}

function edge(from: string, to: string, relation: MemoryBrainEdge["relation"]): MemoryBrainEdge {
  return { id: `edge:${sha(`${from}|${relation}|${to}`).slice(0, 24)}`, from, to, relation };
}

function classifySource(reference: string): Exclude<MemoryBrainNodeClass, "MEMORY" | "PROJECT"> {
  if (reference.includes("/workspace/")) return "WORKSPACE_SOURCE";
  if (reference.startsWith("run:") || reference.includes("/mission/")) return "RUN";
  return "SOURCE";
}

function sourceTitle(reference: string): string {
  const last = reference.split(/[/:]/u).filter(Boolean).at(-1);
  return last ? `Source · ${last}` : "Source";
}

function summarize(content: string): string {
  const clean = content.replace(/\s+/gu, " ").trim();
  return clean.length <= 240 ? clean : `${clean.slice(0, 237)}…`;
}

function emptySignal(id: string): MemoryProductSignal {
  return { id, usageCount: 0, lastUsedAt: null, pinned: false, archivedAt: null };
}

function validateSignal(signal: MemoryProductSignal): MemoryProductSignal {
  if (!Number.isSafeInteger(signal.usageCount) || signal.usageCount < 0)
    throw new TypeError("Memory usageCount must be a non-negative safe integer.");
  if (signal.lastUsedAt !== null) canonicalTime(signal.lastUsedAt);
  if (signal.archivedAt !== null) canonicalTime(signal.archivedAt);
  return signal;
}

function emptyCounts(): Record<MemoryProductStatus, number> {
  return {
    ACTIVE: 0,
    TEMPORARY: 0,
    STALE: 0,
    CONFLICTED: 0,
    SUPERSEDED: 0,
    NOISE_CANDIDATE: 0,
    ARCHIVED: 0,
  };
}

function canonicalTime(value: string): string {
  const parsed = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || !Number.isFinite(parsed))
    throw new TypeError("Memory Brain timestamps must be canonical UTC values.");
  const canonical = new Date(parsed).toISOString();
  if (canonical !== value)
    throw new TypeError("Memory Brain timestamps must be canonical UTC values.");
  return canonical;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableHash(value: unknown): string {
  return sha(JSON.stringify(canonicalize(value)));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .filter((key) => object[key] !== undefined)
      .map((key) => [key, canonicalize(object[key])]),
  );
}
