import assert from "node:assert/strict";
import test from "node:test";
import {
  SkillError,
  SkillRegistry,
  type SkillSynthesisAuthority,
  SkillSynthesisService,
} from "../../src/skills/index.js";

const T0 = "2026-09-03T16:00:00.000Z";
const T1 = "2026-09-03T16:01:00.000Z";

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: "skill-from-task-1",
    instructions: "Reuse the bounded diagnostic sequence and stop when independent tests disagree.",
    missionId: "mission-learn",
    name: "learned.diagnostic_sequence",
    observedAt: T0,
    requiredTools: ["repo.read", "repo.quality"],
    sourceReference: "mission:mission-learn/task:task-learn",
    summary: "Reuse a verified diagnostic sequence from a completed coding task.",
    tags: ["diagnostics", "learned"],
    taskId: "task-learn",
    testRefs: ["test:diagnostic-regression"],
    version: "1.0.0",
    ...overrides,
  };
}

function authority(
  result: "allow" | "deny" | "foreign" | "stale" = "allow",
): SkillSynthesisAuthority {
  return {
    async attestSolvedTask(missionId, taskId) {
      if (result === "deny") return null;
      if (result === "foreign") {
        return {
          evidenceRefs: ["evidence:source-task"],
          missionId: "foreign-mission",
          observedAt: T1,
          taskId,
        };
      }
      if (result === "stale") {
        return {
          evidenceRefs: ["evidence:source-task"],
          missionId,
          observedAt: "2026-09-03T15:59:00.000Z",
          taskId,
        };
      }
      return {
        evidenceRefs: ["evidence:source-task"],
        missionId,
        observedAt: T1,
        taskId,
      };
    },
  };
}

test("a solved task can create only an unprivileged learned candidate", async () => {
  const registry = new SkillRegistry();
  const service = new SkillSynthesisService(registry, authority());

  const created = await service.createCandidate(proposal());
  assert.equal(created.lifecycle, "CANDIDATE");
  assert.equal(created.package.trustClass, "learned");
  assert.equal(created.package.provenance.sourceMissionId, "mission-learn");
  assert.equal(created.package.provenance.sourceTaskId, "task-learn");
  assert.equal(registry.listAvailableSummaries().length, 0);
  assert.throws(
    () => registry.resolve("learned.diagnostic_sequence", "1.0.0"),
    (error: unknown) => error instanceof SkillError && error.code === "DENIED",
  );
});

test("synthesis fails closed without exact solved-task runtime attestation", async () => {
  for (const mode of ["deny", "foreign", "stale"] as const) {
    const registry = new SkillRegistry();
    const service = new SkillSynthesisService(registry, authority(mode));
    await assert.rejects(
      service.createCandidate(proposal()),
      (error: unknown) => error instanceof SkillError && error.code === "DENIED",
    );
    assert.equal(registry.listReviewSummaries().length, 0);
  }
});

test("exact synthesis replay is idempotent while conflicting replay fails closed", async () => {
  const registry = new SkillRegistry();
  const service = new SkillSynthesisService(registry, authority());

  const first = await service.createCandidate(proposal());
  const replay = await service.createCandidate(proposal());
  assert.deepEqual(replay, first);
  assert.equal(registry.listReviewSummaries().length, 1);

  await assert.rejects(
    service.createCandidate(
      proposal({ instructions: "Conflicting instructions under the same replay key." }),
    ),
    (error: unknown) => error instanceof SkillError && error.code === "CONFLICT",
  );
  assert.equal(registry.listReviewSummaries().length, 1);
});

test("candidate proposal schema is exact and package bounds still apply", async () => {
  const registry = new SkillRegistry({ maxInstructionsBytes: 32 });
  const service = new SkillSynthesisService(registry, authority());

  await assert.rejects(service.createCandidate(proposal()), SkillError);
  await assert.rejects(
    service.createCandidate(proposal({ unexpected: true })),
    (error: unknown) => error instanceof SkillError && error.code === "INVALID_INPUT",
  );
  await assert.rejects(
    service.createCandidate(proposal({ observedAt: "today" })),
    (error: unknown) => error instanceof SkillError && error.code === "INVALID_INPUT",
  );
});
