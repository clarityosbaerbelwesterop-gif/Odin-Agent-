import {
  assertIdentifier,
  assertSha256,
  assertText,
  assertToken,
  immutableClone,
  MAX_COLLECTION_ITEMS,
  MAX_REFERENCE_LENGTH,
  MAX_SUMMARY_LENGTH,
  normalizeUniqueTokens,
} from "./internal.js";
import type {
  SpecialistProfile,
  SpecialistSummary,
  SpecialistTrustClass,
  SpecialistWorker,
} from "./types.js";

const MAX_SPECIALISTS = 128;
const MAX_CONCURRENCY_PER_SPECIALIST = 16;
const TRUST_CLASSES = new Set<SpecialistTrustClass>(["test_fixture", "untrusted_worker"]);

interface SpecialistRegistration {
  readonly profile: SpecialistProfile;
  readonly worker: SpecialistWorker;
}

export class SpecialistRegistry {
  readonly #registrations = new Map<string, SpecialistRegistration>();

  register(profile: SpecialistProfile, worker: SpecialistWorker): void {
    const normalized = normalizeProfile(profile);
    if (this.#registrations.size >= MAX_SPECIALISTS) {
      throw new TypeError(`Specialist registry is limited to ${MAX_SPECIALISTS} entries.`);
    }
    const key = specialistKey(normalized.id, normalized.version);
    if (this.#registrations.has(key)) {
      throw new TypeError(`Duplicate specialist registration '${key}'.`);
    }
    if (typeof worker?.execute !== "function") {
      throw new TypeError("Specialist worker must implement execute().");
    }
    this.#registrations.set(key, { profile: immutableClone(normalized), worker });
  }

  list(): readonly SpecialistSummary[] {
    return [...this.#registrations.values()]
      .map(
        ({ profile }): SpecialistSummary => ({
          capabilities: [...profile.capabilities],
          id: profile.id,
          maxConcurrency: profile.maxConcurrency,
          provenanceHash: profile.provenance.contentHash,
          roles: [...profile.roles],
          trustClass: profile.trustClass,
          version: profile.version,
        }),
      )
      .sort(compareSummaries)
      .map((summary) => immutableClone(summary));
  }

  matching(role: string, requiredCapabilities: readonly string[]): readonly SpecialistProfile[] {
    assertToken(role, "role");
    const capabilities = normalizeRequiredCapabilities(requiredCapabilities);
    return [...this.#registrations.values()]
      .map((registration) => registration.profile)
      .filter(
        (profile) =>
          profile.roles.includes(role) &&
          capabilities.every((capability) => profile.capabilities.includes(capability)),
      )
      .sort(compareProfiles)
      .map((profile) => immutableClone(profile));
  }

  resolve(id: string, version: string): SpecialistProfile {
    return immutableClone(this.#registration(id, version).profile);
  }

  worker(id: string, version: string): SpecialistWorker {
    return this.#registration(id, version).worker;
  }

  #registration(id: string, version: string): SpecialistRegistration {
    assertIdentifier(id, "specialistId");
    assertIdentifier(version, "specialistVersion");
    const registration = this.#registrations.get(specialistKey(id, version));
    if (registration === undefined) throw new TypeError("Unknown specialist registration.");
    return registration;
  }
}

function normalizeProfile(profile: SpecialistProfile): SpecialistProfile {
  assertIdentifier(profile.id, "profile.id");
  assertIdentifier(profile.version, "profile.version");
  assertText(profile.description, "profile.description", MAX_SUMMARY_LENGTH);
  const roles = normalizeUniqueTokens(profile.roles, "profile.roles");
  const capabilities = normalizeUniqueTokens(profile.capabilities, "profile.capabilities");
  if (
    !Number.isSafeInteger(profile.maxConcurrency) ||
    profile.maxConcurrency < 1 ||
    profile.maxConcurrency > MAX_CONCURRENCY_PER_SPECIALIST
  ) {
    throw new TypeError(
      `profile.maxConcurrency must be an integer from 1 to ${MAX_CONCURRENCY_PER_SPECIALIST}.`,
    );
  }
  if (!TRUST_CLASSES.has(profile.trustClass)) {
    throw new TypeError("profile.trustClass is not supported.");
  }
  assertText(profile.provenance.source, "profile.provenance.source", MAX_REFERENCE_LENGTH);
  assertIdentifier(profile.provenance.version, "profile.provenance.version");
  assertSha256(profile.provenance.contentHash, "profile.provenance.contentHash");
  return {
    capabilities,
    description: profile.description,
    id: profile.id,
    maxConcurrency: profile.maxConcurrency,
    provenance: structuredClone(profile.provenance),
    roles,
    trustClass: profile.trustClass,
    version: profile.version,
  };
}

function normalizeRequiredCapabilities(values: readonly string[]): string[] {
  if (values.length > MAX_COLLECTION_ITEMS) {
    throw new TypeError(`requiredCapabilities is limited to ${MAX_COLLECTION_ITEMS} entries.`);
  }
  if (values.length === 0) return [];
  return normalizeUniqueTokens(values, "requiredCapabilities");
}

function specialistKey(id: string, version: string): string {
  return `${id}\u0000${version}`;
}

function compareProfiles(left: SpecialistProfile, right: SpecialistProfile): number {
  return left.id.localeCompare(right.id) || left.version.localeCompare(right.version);
}

function compareSummaries(left: SpecialistSummary, right: SpecialistSummary): number {
  return left.id.localeCompare(right.id) || left.version.localeCompare(right.version);
}
