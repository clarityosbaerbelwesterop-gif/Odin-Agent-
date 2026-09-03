import assert from "node:assert/strict";
import test from "node:test";
import { SkillError, SkillRegistry } from "../../src/skills/index.js";

const T0 = "2026-09-03T16:00:00.000Z";
const T1 = "2026-09-03T16:01:00.000Z";

function communityCandidate() {
  return {
    instructions: "Use only the declared bounded tools and stop when verification disagrees.",
    name: "community.safe_review",
    provenance: {
      kind: "community" as const,
      observedAt: T0,
      reference: "community:package-safe-review",
    },
    requiredTools: ["repo.read"],
    summary: "Review a bounded repository surface without mutation authority.",
    tags: ["community", "review"],
    testRefs: ["test:community-review"],
    trustClass: "community" as const,
    version: "1.0.0",
  };
}

test("failed evidence and self-authored community evidence never promote a candidate", () => {
  const registry = new SkillRegistry();
  const candidate = registry.registerCandidate(communityCandidate());

  assert.throws(
    () =>
      registry.verify({
        contentHash: candidate.package.contentHash,
        evidenceRefs: ["evidence:failed-independent-test"],
        name: candidate.package.name,
        observedAt: T1,
        producerClass: "independent_test",
        status: "FAIL",
        version: candidate.package.version,
      }),
    (error: unknown) => error instanceof SkillError && error.code === "VERIFICATION_FAILED",
  );

  for (const producerClass of ["model", "runtime", "worker"] as const) {
    assert.throws(
      () =>
        registry.verify({
          contentHash: candidate.package.contentHash,
          evidenceRefs: ["evidence:self-authored-pass"],
          name: candidate.package.name,
          observedAt: T1,
          producerClass,
          status: "PASS",
          version: candidate.package.version,
        }),
      (error: unknown) => error instanceof SkillError && error.code === "VERIFICATION_FAILED",
    );
  }

  assert.equal(registry.resolveForReview(candidate.package.name, candidate.package.version).lifecycle, "CANDIDATE");
  assert.equal(registry.listAvailableSummaries().length, 0);
  assert.deepEqual(
    registry.history(candidate.package.name, candidate.package.version).map((event) => event.action),
    ["REGISTERED"],
  );
});
