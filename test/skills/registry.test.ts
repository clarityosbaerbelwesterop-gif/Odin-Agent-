import assert from "node:assert/strict";
import test from "node:test";
import { SkillError, SkillRegistry } from "../../src/skills/index.js";
import { ToolRegistry, ToolRuntimeError } from "../../src/tools/index.js";

const T0 = "2026-09-03T16:00:00.000Z";
const T1 = "2026-09-03T16:01:00.000Z";
const T2 = "2026-09-03T16:02:00.000Z";
const T3 = "2026-09-03T16:03:00.000Z";

function projectSkill(version = "1.0.0") {
  return {
    instructions: "Read the bounded repository context, make the smallest change, then verify it.",
    name: "coding.safe_patch",
    provenance: {
      kind: "project" as const,
      observedAt: T0,
      reference: "docs/skills/coding-safe-patch.md",
    },
    requiredTools: ["repo.read", "repo.patch", "repo.quality"],
    summary: "Perform one scoped repository patch with a required quality gate.",
    tags: ["coding", "repository", "verification"],
    testRefs: ["test:quality-gate", "test:path-scope"],
    trustClass: "project" as const,
    version,
  };
}

function learnedSkill(version = "1.0.0") {
  return {
    instructions: "Reproduce the verified migration sequence and stop on any schema mismatch.",
    name: "learned.safe_migration",
    provenance: {
      kind: "learned" as const,
      observedAt: T0,
      reference: "mission:mission-1/task:task-1",
      sourceMissionId: "mission-1",
      sourceTaskId: "task-1",
    },
    requiredTools: ["repo.read", "repo.quality"],
    summary: "Reuse a previously verified migration procedure.",
    tags: ["database", "learned"],
    testRefs: ["evidence:migration-regression"],
    trustClass: "learned" as const,
    version,
  };
}

test("discovery is compact, deterministic, and full instructions load progressively", () => {
  const registry = new SkillRegistry();
  const first = registry.registerTrusted(projectSkill());
  const secondRegistry = new SkillRegistry();
  const reordered = projectSkill();
  secondRegistry.registerTrusted({
    ...reordered,
    requiredTools: [...reordered.requiredTools].reverse(),
    tags: [...reordered.tags].reverse(),
    testRefs: [...reordered.testRefs].reverse(),
  });

  const summaries = registry.listAvailableSummaries();
  assert.equal(summaries.length, 1);
  const summary = summaries[0];
  assert.ok(summary);
  assert.equal("instructions" in summary, false);
  assert.equal(JSON.stringify(summaries).includes("smallest change"), false);
  assert.deepEqual(summary.requiredTools, ["repo.patch", "repo.quality", "repo.read"]);
  const reorderedSummary = secondRegistry.listAvailableSummaries()[0];
  assert.ok(reorderedSummary);
  assert.equal(first.package.contentHash, reorderedSummary.contentHash);

  const loaded = registry.resolve("coding.safe_patch", "1.0.0");
  assert.match(loaded.instructions, /smallest change/u);
  assert.throws(() => (loaded.tags as string[]).push("mutated"), TypeError);
  assert.deepEqual(registry.resolve("coding.safe_patch", "1.0.0").tags, [
    "coding",
    "repository",
    "verification",
  ]);
});

test("malformed, oversized, duplicate, and foreign-trust packages fail closed", () => {
  const registry = new SkillRegistry({ maxInstructionsBytes: 32 });
  assert.throws(() => registry.registerTrusted(projectSkill()), SkillError);

  const normal = new SkillRegistry();
  normal.registerTrusted(projectSkill());
  assert.deepEqual(
    normal.registerTrusted(projectSkill()),
    normal.resolveForReview("coding.safe_patch", "1.0.0"),
  );
  assert.throws(
    () => normal.registerTrusted({ ...projectSkill(), summary: "Conflicting immutable content" }),
    (error: unknown) => error instanceof SkillError && error.code === "CONFLICT",
  );
  assert.throws(
    () => normal.registerTrusted({ ...projectSkill("2.0.0"), trustClass: "learned" }),
    (error: unknown) => error instanceof SkillError && error.code === "DENIED",
  );
  assert.throws(
    () => normal.registerTrusted({ ...projectSkill("2.0.0"), unexpected: true }),
    (error: unknown) => error instanceof SkillError && error.code === "INVALID_INPUT",
  );
  assert.throws(
    () => normal.resolve("unknown.skill", "1.0.0"),
    (error: unknown) => error instanceof SkillError && error.code === "NOT_FOUND",
  );
});

test("learned skills cannot load, self-verify, or activate before independent verification", () => {
  const registry = new SkillRegistry();
  const candidate = registry.registerCandidate(learnedSkill());
  assert.equal(candidate.lifecycle, "CANDIDATE");
  assert.equal(registry.listAvailableSummaries().length, 0);
  assert.equal(registry.listReviewSummaries().length, 1);
  assert.throws(
    () => registry.resolve("learned.safe_migration", "1.0.0"),
    (error: unknown) => error instanceof SkillError && error.code === "DENIED",
  );
  assert.throws(
    () =>
      registry.activate({
        actor: "trusted_runtime",
        name: "learned.safe_migration",
        promotedAt: T1,
        version: "1.0.0",
      }),
    (error: unknown) => error instanceof SkillError && error.code === "DENIED",
  );

  for (const producerClass of ["model", "worker", "runtime"] as const) {
    assert.throws(
      () =>
        registry.verify({
          contentHash: candidate.package.contentHash,
          evidenceRefs: ["evidence:claimed-pass"],
          name: "learned.safe_migration",
          observedAt: T1,
          producerClass,
          status: "PASS",
          version: "1.0.0",
        }),
      (error: unknown) => error instanceof SkillError && error.code === "VERIFICATION_FAILED",
    );
  }
  assert.throws(
    () =>
      registry.verify({
        contentHash: "0".repeat(64),
        evidenceRefs: ["evidence:independent"],
        name: "learned.safe_migration",
        observedAt: T1,
        producerClass: "independent_verifier",
        status: "PASS",
        version: "1.0.0",
      }),
    (error: unknown) => error instanceof SkillError && error.code === "VERIFICATION_FAILED",
  );

  const verified = registry.verify({
    contentHash: candidate.package.contentHash,
    evidenceRefs: ["evidence:independent"],
    name: "learned.safe_migration",
    observedAt: T1,
    producerClass: "independent_verifier",
    status: "PASS",
    version: "1.0.0",
  });
  assert.equal(verified.lifecycle, "VERIFIED");
  const active = registry.activate({
    actor: "trusted_runtime",
    name: "learned.safe_migration",
    promotedAt: T2,
    version: "1.0.0",
  });
  assert.equal(active.lifecycle, "ACTIVE");
  assert.equal(
    registry.resolveActive("learned.safe_migration").contentHash,
    candidate.package.contentHash,
  );
});

test("activation supersedes one version, rollback is explicit, and revocation blocks loading", () => {
  const registry = new SkillRegistry();
  registry.registerTrusted(projectSkill("1.0.0"));
  registry.registerTrusted(projectSkill("2.0.0"));

  registry.activate({
    actor: "trusted_runtime",
    name: "coding.safe_patch",
    promotedAt: T1,
    version: "1.0.0",
  });
  registry.activate({
    actor: "trusted_runtime",
    name: "coding.safe_patch",
    promotedAt: T2,
    version: "2.0.0",
  });
  assert.equal(registry.resolveForReview("coding.safe_patch", "1.0.0").lifecycle, "VERIFIED");
  assert.equal(registry.resolveActive("coding.safe_patch").version, "2.0.0");

  registry.rollback({
    actor: "user_approved",
    name: "coding.safe_patch",
    promotedAt: T3,
    version: "1.0.0",
  });
  assert.equal(registry.resolveActive("coding.safe_patch").version, "1.0.0");
  assert.equal(registry.resolveForReview("coding.safe_patch", "2.0.0").lifecycle, "VERIFIED");

  registry.revoke({
    actor: "user_approved",
    name: "coding.safe_patch",
    revokedAt: T3,
    version: "1.0.0",
  });
  assert.equal(registry.resolveForReview("coding.safe_patch", "1.0.0").lifecycle, "REVOKED");
  assert.throws(() => registry.resolve("coding.safe_patch", "1.0.0"), SkillError);
  assert.throws(() => registry.resolveActive("coding.safe_patch"), SkillError);
});

test("skill tool declarations never register handlers or mint execution authority", () => {
  const skills = new SkillRegistry();
  const tools = new ToolRegistry();
  skills.registerTrusted(projectSkill());
  skills.activate({
    actor: "trusted_runtime",
    name: "coding.safe_patch",
    promotedAt: T1,
    version: "1.0.0",
  });

  assert.deepEqual(skills.resolveActive("coding.safe_patch").requiredTools, [
    "repo.patch",
    "repo.quality",
    "repo.read",
  ]);
  assert.deepEqual(tools.listSummaries(), []);
  assert.throws(
    () => tools.resolveManifest("repo.read", "1.0.0"),
    (error: unknown) => error instanceof ToolRuntimeError && error.category === "invalid_input",
  );
});

test("lifecycle history records promotion, supersession, rollback, verification, and revocation", () => {
  const registry = new SkillRegistry();
  const learned = registry.registerCandidate(learnedSkill());
  registry.verify({
    contentHash: learned.package.contentHash,
    evidenceRefs: ["evidence:independent"],
    name: learned.package.name,
    observedAt: T1,
    producerClass: "independent_verifier",
    status: "PASS",
    version: learned.package.version,
  });
  registry.activate({
    actor: "trusted_runtime",
    name: learned.package.name,
    promotedAt: T2,
    version: learned.package.version,
  });

  const learnedHistory = registry.history(learned.package.name, learned.package.version);
  assert.deepEqual(
    learnedHistory.map((event) => event.action),
    ["REGISTERED", "VERIFIED", "ACTIVATED"],
  );
  const verificationEvent = learnedHistory[1];
  assert.ok(verificationEvent);
  assert.deepEqual(verificationEvent.evidenceRefs, ["evidence:independent"]);
  assert.equal(verificationEvent.producerClass, "independent_verifier");
  assert.throws(() => (verificationEvent.evidenceRefs as string[]).push("mutated"), TypeError);

  registry.registerTrusted(projectSkill("1.0.0"));
  registry.registerTrusted(projectSkill("2.0.0"));
  registry.activate({
    actor: "trusted_runtime",
    name: "coding.safe_patch",
    promotedAt: T1,
    version: "1.0.0",
  });
  registry.activate({
    actor: "trusted_runtime",
    name: "coding.safe_patch",
    promotedAt: T2,
    version: "2.0.0",
  });
  registry.rollback({
    actor: "user_approved",
    name: "coding.safe_patch",
    promotedAt: T3,
    version: "1.0.0",
  });
  registry.revoke({
    actor: "user_approved",
    name: "coding.safe_patch",
    revokedAt: T3,
    version: "1.0.0",
  });

  assert.deepEqual(
    registry.history("coding.safe_patch").map((event) => event.action),
    [
      "REGISTERED",
      "REGISTERED",
      "ACTIVATED",
      "SUPERSEDED",
      "ACTIVATED",
      "SUPERSEDED",
      "ROLLED_BACK",
      "REVOKED",
    ],
  );
  assert.throws(
    () => registry.history(undefined, "1.0.0"),
    (error: unknown) => error instanceof SkillError && error.code === "INVALID_INPUT",
  );
});
