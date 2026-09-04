export type MemoryKind = "episodic" | "project" | "semantic" | "user_preference" | "working";

export type MemorySensitivity = "internal" | "public" | "sensitive";
export type MemorySourceClass =
  | "explicit_user"
  | "import"
  | "model_summary"
  | "repository"
  | "tool"
  | "verified_learning";

export interface MemoryScope {
  readonly userId: string;
  readonly projectId: string;
  readonly missionId?: string;
}

export interface MemoryProvenance {
  readonly sourceClass: MemorySourceClass;
  readonly reference: string;
  readonly sourceVersion: string;
  readonly observedAt: string;
  readonly contentHash: string;
}

export interface MemoryRecordInput {
  readonly id: string;
  readonly key: string;
  readonly kind: MemoryKind;
  readonly scope: MemoryScope;
  readonly content: string;
  readonly tags: readonly string[];
  readonly sensitivity: MemorySensitivity;
  readonly provenance: MemoryProvenance;
  readonly expiresAt?: string;
}

interface StoredMemoryBase {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly version: number;
  readonly updatedAt: string;
  readonly recordHash: string;
}

export interface ActiveMemoryRecord extends StoredMemoryBase {
  readonly status: "active";
  readonly key: string;
  readonly kind: MemoryKind;
  readonly tags: readonly string[];
  readonly sensitivity: MemorySensitivity;
  readonly content: string;
  readonly provenance: MemoryProvenance;
  readonly expiresAt?: string;
}

export interface TombstonedMemoryRecord extends StoredMemoryBase {
  readonly status: "tombstoned";
  readonly content: null;
  readonly previousContentHash: string;
}

export type StoredMemoryRecord = ActiveMemoryRecord | TombstonedMemoryRecord;

export interface MemoryRevision {
  readonly action: "tombstoned" | "written";
  readonly id: string;
  readonly recordHash: string;
  readonly sourceReference: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface MemoryWriteCommand {
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly record: MemoryRecordInput;
  readonly updatedAt: string;
}

export interface MemoryTombstoneCommand {
  readonly expectedVersion: number;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly scope: MemoryScope;
  readonly updatedAt: string;
}

export interface MemoryWriteResult {
  readonly record: StoredMemoryRecord;
  readonly replayed: boolean;
  readonly storeRevision: number;
}

export interface MemoryRetrievalQuery {
  readonly userId: string;
  readonly projectId: string;
  readonly missionId?: string;
  readonly kinds: readonly MemoryKind[];
  readonly text: string;
  readonly tags?: readonly string[];
  readonly limit: number;
  readonly evaluatedAt: string;
}

export interface RetrievedMemory {
  readonly record: ActiveMemoryRecord;
  readonly score: number;
}

export interface MemoryChange {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly storeRevision: number;
}

export interface MemoryReader {
  retrieve(query: MemoryRetrievalQuery): Promise<readonly RetrievedMemory[]>;
  subscribe(listener: (change: MemoryChange) => void): () => void;
}

export interface MemoryStore extends MemoryReader {
  readonly revision: number;
  write(command: MemoryWriteCommand): Promise<MemoryWriteResult>;
  tombstone(command: MemoryTombstoneCommand): Promise<MemoryWriteResult>;
  get(id: string, scope: MemoryScope): Promise<StoredMemoryRecord | undefined>;
  history(id: string, scope: MemoryScope): Promise<readonly MemoryRevision[]>;
}
