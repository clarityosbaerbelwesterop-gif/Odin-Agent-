import {
  assertSha256,
  canonicalTimestamp,
  identifier,
  safeInteger,
} from "./internal.js";
import type { CachedRoutingResult, RoutingDecision } from "./types.js";
import { RoutingError } from "./types.js";

export class BoundedRoutingResultCache {
  readonly #maxEntries: number;
  readonly #entries = new Map<string, CachedRoutingResult>();

  constructor(maxEntries = 128) {
    this.#maxEntries = safeInteger(maxEntries, "routing cache maxEntries", 1, 10_000);
  }

  put(
    route: RoutingDecision,
    artifactRefValue: unknown,
    resultHashValue: unknown,
    createdAtValue: unknown,
  ): CachedRoutingResult | null {
    if (!route.cache.writeAllowed || route.cache.key === undefined) return null;
    const artifactRef = identifier(artifactRefValue, "routing cache artifactRef");
    const resultHash = assertSha256(resultHashValue, "routing cache resultHash");
    const createdAt = canonicalTimestamp(createdAtValue, "routing cache createdAt");
    const expiresAt = expiration(createdAt, route.cache.maxAgeMs);
    const record = freezeRecord({
      artifactRef,
      createdAt,
      decisionHash: assertSha256(route.decisionHash, "routing decisionHash"),
      expiresAt,
      key: assertSha256(route.cache.key, "routing cache key"),
      resultHash,
    });
    const existing = this.#entries.get(record.key);
    if (existing !== undefined) {
      if (!sameRecord(existing, record)) {
        throw new RoutingError(
          "INVALID_INPUT",
          "Conflicting routing cache writes for the same immutable cache key are denied.",
        );
      }
      return cloneRecord(existing);
    }
    this.#entries.set(record.key, record);
    this.#evictOverflow();
    return cloneRecord(record);
  }

  get(route: RoutingDecision, nowValue: unknown): CachedRoutingResult | null {
    if (!route.cache.readAllowed || route.cache.key === undefined) return null;
    const now = canonicalTimestamp(nowValue, "routing cache read timestamp");
    const key = assertSha256(route.cache.key, "routing cache key");
    const record = this.#entries.get(key);
    if (record === undefined) return null;
    if (record.decisionHash !== route.decisionHash) return null;
    if (Date.parse(now) >= Date.parse(record.expiresAt)) {
      this.#entries.delete(key);
      return null;
    }
    return cloneRecord(record);
  }

  size(): number {
    return this.#entries.size;
  }

  #evictOverflow(): void {
    while (this.#entries.size > this.#maxEntries) {
      const oldest = [...this.#entries.values()].sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.key.localeCompare(right.key),
      )[0];
      if (oldest === undefined) return;
      this.#entries.delete(oldest.key);
    }
  }
}

function expiration(createdAt: string, maxAgeMs: number): string {
  const expiry = Date.parse(createdAt) + safeInteger(maxAgeMs, "routing cache maxAgeMs", 1);
  const date = new Date(expiry);
  if (Number.isNaN(date.valueOf())) {
    throw new RoutingError("INVALID_INPUT", "Routing cache expiry exceeds timestamp bounds.");
  }
  return date.toISOString();
}

function sameRecord(left: CachedRoutingResult, right: CachedRoutingResult): boolean {
  return (
    left.artifactRef === right.artifactRef &&
    left.createdAt === right.createdAt &&
    left.decisionHash === right.decisionHash &&
    left.expiresAt === right.expiresAt &&
    left.key === right.key &&
    left.resultHash === right.resultHash
  );
}

function freezeRecord(value: CachedRoutingResult): CachedRoutingResult {
  return Object.freeze({ ...value });
}

function cloneRecord(value: CachedRoutingResult): CachedRoutingResult {
  return freezeRecord({ ...value });
}
