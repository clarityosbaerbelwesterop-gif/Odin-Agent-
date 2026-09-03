import {
  assertIdentifier,
  assertText,
  MAX_COLLECTION_ITEMS,
  MAX_REFERENCE_LENGTH,
  normalizeRepositoryPath,
} from "./internal.js";
import type { OwnershipClaim, OwnershipLease } from "./types.js";

export function normalizeOwnershipClaims(
  claims: readonly OwnershipClaim[],
  name = "ownership",
): readonly OwnershipClaim[] {
  if (!Array.isArray(claims) || claims.length > MAX_COLLECTION_ITEMS) {
    throw new TypeError(`${name} is limited to ${MAX_COLLECTION_ITEMS} entries.`);
  }
  const normalized = claims.map((claim, index): OwnershipClaim => {
    if (!isPlainObject(claim)) throw new TypeError(`${name}[${index}] must be an object.`);
    const keys = Object.keys(claim).sort();
    if (keys.length !== 3 || keys[0] !== "access" || keys[1] !== "key" || keys[2] !== "namespace") {
      throw new TypeError(`${name}[${index}] contains missing or unsupported fields.`);
    }
    const namespace = claim.namespace;
    const access = claim.access;
    const rawKey = claim.key;
    if (namespace !== "repository" && namespace !== "resource" && namespace !== "state") {
      throw new TypeError(`${name}[${index}].namespace is not supported.`);
    }
    if (access !== "read" && access !== "write") {
      throw new TypeError(`${name}[${index}].access is not supported.`);
    }
    if (typeof rawKey !== "string") throw new TypeError(`${name}[${index}].key must be a string.`);
    const key = normalizeOwnershipKey(namespace, rawKey, `${name}[${index}].key`);
    return { access, key, namespace };
  });
  normalized.sort(compareClaims);
  for (let index = 1; index < normalized.length; index += 1) {
    if (sameClaim(normalized[index - 1], normalized[index])) {
      throw new TypeError(`${name} must not contain duplicate claims.`);
    }
  }
  return normalized;
}

export function conflictingTaskIds(
  claims: readonly OwnershipClaim[],
  leases: readonly OwnershipLease[],
): readonly string[] {
  const conflicts = new Set<string>();
  for (const lease of leases) {
    if (claims.some((claim) => lease.claims.some((active) => claimsConflict(claim, active)))) {
      conflicts.add(lease.taskId);
    }
  }
  return [...conflicts].sort();
}

export function pathIsOwnedForWrite(path: string, claims: readonly OwnershipClaim[]): boolean {
  const normalized = normalizeRepositoryPath(path, "filesChanged");
  return claims.some(
    (claim) =>
      claim.namespace === "repository" &&
      claim.access === "write" &&
      (claim.key === normalized || normalized.startsWith(`${claim.key}/`)),
  );
}

function normalizeOwnershipKey(
  namespace: OwnershipClaim["namespace"],
  value: string,
  name: string,
): string {
  if (namespace === "repository") return normalizeRepositoryPath(value, name);
  assertText(value, name, MAX_REFERENCE_LENGTH);
  assertIdentifier(value, name);
  return value;
}

function claimsConflict(left: OwnershipClaim, right: OwnershipClaim): boolean {
  if (left.namespace !== right.namespace) return false;
  if (left.access === "read" && right.access === "read") return false;
  if (left.namespace === "repository") return repositoryKeysIntersect(left.key, right.key);
  return left.key === right.key;
}

function repositoryKeysIntersect(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function compareClaims(left: OwnershipClaim, right: OwnershipClaim): number {
  return (
    left.namespace.localeCompare(right.namespace) ||
    left.key.localeCompare(right.key) ||
    left.access.localeCompare(right.access)
  );
}

function sameClaim(left: OwnershipClaim | undefined, right: OwnershipClaim | undefined): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.namespace === right.namespace &&
    left.key === right.key &&
    left.access === right.access
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
