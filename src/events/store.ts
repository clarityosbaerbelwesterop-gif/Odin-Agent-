export interface EventAppendItem<T> {
  readonly occurredAt: string;
  readonly data: T;
}

export interface StoredEvent<T> extends EventAppendItem<T> {
  readonly missionId: string;
  readonly sequence: number;
  readonly aggregateVersion: number;
  readonly idempotencyKey: string;
}

export interface EventStore<T> {
  append(
    missionId: string,
    expectedVersion: number,
    idempotencyKey: string,
    items: readonly EventAppendItem<T>[],
  ): Promise<readonly StoredEvent<T>[]>;
  load(missionId: string): Promise<readonly StoredEvent<T>[]>;
}

export class EventStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventStoreConflictError";
  }
}

interface IdempotencyRecord<T> {
  readonly fingerprint: string;
  readonly events: readonly StoredEvent<T>[];
}

export class InMemoryEventStore<T> implements EventStore<T> {
  readonly #streams = new Map<string, StoredEvent<T>[]>();
  readonly #idempotency = new Map<string, IdempotencyRecord<T>>();

  async append(
    missionId: string,
    expectedVersion: number,
    idempotencyKey: string,
    items: readonly EventAppendItem<T>[],
  ): Promise<readonly StoredEvent<T>[]> {
    assertIdentifier(missionId, "missionId");
    assertIdentifier(idempotencyKey, "idempotencyKey");
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw new TypeError("expectedVersion must be a non-negative safe integer.");
    }
    if (items.length === 0) throw new TypeError("Event append batches must not be empty.");
    for (const item of items) {
      if (item.occurredAt.trim() === "" || Number.isNaN(Date.parse(item.occurredAt))) {
        throw new TypeError("Event occurredAt must be a parseable timestamp.");
      }
    }

    const idempotencyScope = `${missionId}\u0000${idempotencyKey}`;
    const fingerprint = stableFingerprint(items);
    const replay = this.#idempotency.get(idempotencyScope);
    if (replay !== undefined) {
      if (replay.fingerprint !== fingerprint) {
        throw new EventStoreConflictError(
          "Idempotency key was reused for a different event batch.",
        );
      }
      return cloneEvents(replay.events);
    }

    const current = this.#streams.get(missionId) ?? [];
    if (current.length !== expectedVersion) {
      throw new EventStoreConflictError(
        `Optimistic version conflict: expected ${expectedVersion}, current ${current.length}.`,
      );
    }

    const appended = items.map((item, index): StoredEvent<T> => {
      const version = expectedVersion + index + 1;
      return {
        aggregateVersion: version,
        data: structuredClone(item.data),
        idempotencyKey,
        missionId,
        occurredAt: item.occurredAt,
        sequence: version,
      };
    });

    const nextStream = [...current, ...appended];
    this.#streams.set(missionId, nextStream);
    this.#idempotency.set(idempotencyScope, {
      events: cloneEvents(appended),
      fingerprint,
    });
    return cloneEvents(appended);
  }

  async load(missionId: string): Promise<readonly StoredEvent<T>[]> {
    assertIdentifier(missionId, "missionId");
    return cloneEvents(this.#streams.get(missionId) ?? []);
  }
}

function cloneEvents<T>(events: readonly StoredEvent<T>[]): readonly StoredEvent<T>[] {
  return structuredClone(events);
}

function stableFingerprint<T>(items: readonly EventAppendItem<T>[]): string {
  return JSON.stringify(items.map((item) => canonicalize(item)));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, canonicalize(object[key])]),
  );
}

function assertIdentifier(value: string, name: string): void {
  if (value.trim() === "") throw new TypeError(`${name} must be non-empty.`);
}
