import assert from "node:assert/strict";
import test from "node:test";
import {
  CapabilityCurationError,
  type CapabilityCurationReport,
  capabilityCurationReportHash,
  proposeCapabilityReplay,
} from "../../src/capability-packs/index.js";
import { SkillRegistry } from "../../src/skills/index.js";

const NOW = "2026-09-04T12:00:00.000Z";

function report(
  hashCharacter: string,
  overrides: Partial<CapabilityCurationReport> = {},
): CapabilityCurationReport {
  const value: CapabilityCurationReport = {
    candidate: {
      contentHash: "a".repeat(64),
      name: `skill-${hashCharacter}`,
      version: "v1",
    },
    candidateContextBytes: 1_000,
    cases: [
      {
        candidateQualityBps: 8_500,
        evidenceRef: `heldout:${hashCharacter}`,
        id: "case-a",
        liftBps: 300,
        passed: true,
        taskClass: "coding-change",
      },
    ],
    decision: "PASS",
    domain: "coding",
    evaluatedAt: "2026-09-04T11:00:00.000Z",
    evidenceRefs: [`heldout:${hashCharacter}`],
    novelProcedureKeys: ["coding.surgical-diff"],
    procedureKeys: ["coding.surgical-diff"],
    reasons: [],
    reportHash: "0".repeat(64),
    taskClasses: ["coding-change"],
    totalLiftBps: 300,
    ...overrides,
  };
  return { ...value, reportHash: capabilityCurationReportHash(value) };
}

function actionsByCandidate(result: ReturnType<typeof proposeCapabilityReplay>) {
  return Object.fromEntries(
    result.proposals.map((proposal) => [proposal.candidate.name, proposal.action]),
  );
}

test("offline replay emits bounded proposal actions without lifecycle authority", () => {
  const skills = new SkillRegistry();
  const candidate = skills.registerCandidate({
    instructions: "Keep edits minimal and grounded in repository evidence.",
    name: "skill-a",
    provenance: { kind: "community", observedAt: NOW, reference: "github:example/a" },
    requiredTools: [],
    summary: "Surgical changes.",
    tags: ["coding"],
    testRefs: ["m14:a"],
    trustClass: "community",
    version: "v1",
  });

  const result = proposeCapabilityReplay(
    [
      report("a"),
      report("b", { candidateContextBytes: 20_000 }),
      report("c", {
        decision: "REDUNDANT",
        evaluatedAt: null,
        reasons: ["NO_NOVEL_PROCEDURE"],
      }),
      report("d", {
        decision: "FAIL",
        reasons: ["CASE:case-a:SAFETY"],
      }),
      report("e", {
        decision: "FAIL",
        reasons: ["AVERAGE_LIFT_BELOW_FLOOR"],
      }),
    ],
    NOW,
  );

  assert.deepEqual(actionsByCandidate(result), {
    "skill-a": "KEEP",
    "skill-b": "COMPRESS",
    "skill-c": "DEDUPLICATE",
    "skill-d": "REVIEW",
    "skill-e": "RETEST",
  });
  assert.equal(
    skills.resolveForReview(candidate.package.name, candidate.package.version).lifecycle,
    "CANDIDATE",
  );
  assert.equal("verify" in result, false);
  assert.equal("activate" in result, false);
});

test("stale evaluation is proposed for retest instead of being silently reused", () => {
  const stale = report("f", { evaluatedAt: "2026-07-01T00:00:00.000Z" });

  const result = proposeCapabilityReplay([stale], NOW, {
    staleAfterMs: 7 * 24 * 60 * 60 * 1_000,
  });

  assert.equal(result.proposals[0]?.action, "RETEST");
  assert.deepEqual(result.proposals[0]?.reasons, ["STALE_EVALUATION"]);
});

test("low measured lift is reviewed while stronger measured lift is kept", () => {
  const low = report("1", {
    cases: [
      {
        candidateQualityBps: 8_100,
        evidenceRef: "heldout:low",
        id: "case-a",
        liftBps: 50,
        passed: true,
        taskClass: "coding-change",
      },
    ],
    totalLiftBps: 50,
  });
  const strong = report("2", { totalLiftBps: 500 });

  const result = proposeCapabilityReplay([strong, low], NOW, { lowAverageLiftBps: 100 });

  assert.deepEqual(actionsByCandidate(result), {
    "skill-1": "REVIEW",
    "skill-2": "KEEP",
  });
});

test("replay result is deterministic across report ordering", () => {
  const first = report("3");
  const second = report("4", { decision: "FAIL", reasons: ["AVERAGE_LIFT_BELOW_FLOOR"] });

  const forward = proposeCapabilityReplay([first, second], NOW);
  const reverse = proposeCapabilityReplay([second, first], NOW);

  assert.deepEqual(forward, reverse);
});

test("tampered reports fail closed before they can influence replay proposals", () => {
  const original = report("7");
  const tampered = { ...original, totalLiftBps: original.totalLiftBps + 500 };

  assert.throws(
    () => proposeCapabilityReplay([tampered], NOW),
    (error: unknown) => error instanceof CapabilityCurationError && error.code === "INVALID_INPUT",
  );
});

test("duplicate hashes malformed timestamps and proposal bounds fail closed", () => {
  const first = report("5");

  assert.throws(
    () => proposeCapabilityReplay([first, first], NOW),
    (error: unknown) => error instanceof CapabilityCurationError && error.code === "INVALID_INPUT",
  );
  assert.throws(
    () => proposeCapabilityReplay([first], "2026-09-04"),
    (error: unknown) => error instanceof CapabilityCurationError && error.code === "INVALID_INPUT",
  );
  assert.throws(
    () => proposeCapabilityReplay([first, report("6")], NOW, { maxProposals: 1 }),
    (error: unknown) => error instanceof CapabilityCurationError && error.code === "INVALID_INPUT",
  );
});
