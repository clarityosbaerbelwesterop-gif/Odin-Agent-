import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type SpecialistAssignment,
  type SpecialistProfile,
  type SpecialistProposal,
  SpecialistRegistry,
  type SpecialistWorker,
} from "../../src/coordination/index.js";

const HASH = "a".repeat(64);

class FixtureWorker implements SpecialistWorker {
  async execute(assignment: SpecialistAssignment): Promise<SpecialistProposal> {
    return {
      artifacts: [],
      assignmentId: assignment.id,
      assumptions: [],
      completedAt: assignment.lease.issuedAt,
      evidence: [],
      filesChanged: [],
      missionId: assignment.missionId,
      outcome: "BLOCKED",
      remainingWork: ["Execution is not part of the registry test."],
      risks: [],
      specialistId: assignment.lease.specialistId,
      specialistVersion: assignment.lease.specialistVersion,
      startedAt: assignment.lease.issuedAt,
      summary: "Registry fixture only.",
      taskId: assignment.taskId,
      verificationStatus: "BLOCKED",
    };
  }
}

function profile(overrides: Partial<SpecialistProfile> = {}): SpecialistProfile {
  return {
    capabilities: ["code_review", "typescript"],
    description: "Reviews bounded TypeScript changes.",
    id: "reviewer-a",
    maxConcurrency: 1,
    provenance: { contentHash: HASH, source: "builtin:reviewer-a", version: "1" },
    roles: ["reviewer"],
    trustClass: "test_fixture",
    version: "1.0.0",
    ...overrides,
  };
}

test("registry exposes deterministic compact metadata without worker handlers", () => {
  const registry = new SpecialistRegistry();
  registry.register(profile({ id: "reviewer-b" }), new FixtureWorker());
  registry.register(profile({ id: "reviewer-a" }), new FixtureWorker());

  const summaries = registry.list();
  assert.deepEqual(
    summaries.map((item) => item.id),
    ["reviewer-a", "reviewer-b"],
  );
  const firstSummary = summaries[0];
  assert.ok(firstSummary);
  assert.equal("description" in firstSummary, false);
  assert.equal("worker" in firstSummary, false);
  assert.equal(firstSummary.provenanceHash, HASH);
});

test("role and all required capabilities select specialists in stable order", () => {
  const registry = new SpecialistRegistry();
  registry.register(profile({ id: "z-reviewer" }), new FixtureWorker());
  registry.register(
    profile({ capabilities: ["code_review", "security", "typescript"], id: "a-security" }),
    new FixtureWorker(),
  );
  registry.register(profile({ id: "implementer", roles: ["implementer"] }), new FixtureWorker());

  assert.deepEqual(
    registry.matching("reviewer", ["typescript", "code_review"]).map((item) => item.id),
    ["a-security", "z-reviewer"],
  );
  assert.deepEqual(
    registry.matching("reviewer", ["security"]).map((item) => item.id),
    ["a-security"],
  );
  assert.deepEqual(registry.matching("reviewer", ["rust"]), []);
});

test("profiles and returned metadata are defensive immutable copies", () => {
  const registry = new SpecialistRegistry();
  const mutableProfile = profile();
  registry.register(mutableProfile, new FixtureWorker());
  (mutableProfile.capabilities as string[])[0] = "tampered";

  const resolved = registry.resolve("reviewer-a", "1.0.0");
  assert.deepEqual(resolved.capabilities, ["code_review", "typescript"]);
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.capabilities), true);
  assert.throws(() => (resolved.capabilities as string[]).push("tampered"), TypeError);
});

test("duplicate registrations and unknown versions fail closed", () => {
  const registry = new SpecialistRegistry();
  registry.register(profile(), new FixtureWorker());
  assert.throws(() => registry.register(profile(), new FixtureWorker()), /Duplicate/u);
  registry.register(profile({ version: "2.0.0" }), new FixtureWorker());
  assert.equal(registry.resolve("reviewer-a", "2.0.0").version, "2.0.0");
  assert.throws(() => registry.resolve("reviewer-a", "3.0.0"), /Unknown/u);
});

test("malformed capabilities, provenance, capacity, trust, and handlers are rejected", () => {
  const registry = new SpecialistRegistry();
  assert.throws(
    () => registry.register(profile({ capabilities: ["Bad Capability"] }), new FixtureWorker()),
    /lowercase capability token/u,
  );
  assert.throws(
    () => registry.register(profile({ roles: ["reviewer", "reviewer"] }), new FixtureWorker()),
    /duplicates/u,
  );
  assert.throws(
    () => registry.register(profile({ maxConcurrency: 0 }), new FixtureWorker()),
    /maxConcurrency/u,
  );
  assert.throws(
    () =>
      registry.register(
        profile({ trustClass: "privileged" as SpecialistProfile["trustClass"] }),
        new FixtureWorker(),
      ),
    /trustClass/u,
  );
  assert.throws(
    () =>
      registry.register(
        profile({ provenance: { contentHash: "bad", source: "fixture", version: "1" } }),
        new FixtureWorker(),
      ),
    /SHA-256/u,
  );
  assert.throws(
    () => registry.register(profile(), {} as SpecialistWorker),
    /must implement execute/u,
  );
});
