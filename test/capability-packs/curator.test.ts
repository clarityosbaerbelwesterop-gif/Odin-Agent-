import assert from "node:assert/strict";
import test from "node:test";
import {
  CapabilityCurationError,
  CapabilityCurator,
  type CapabilityEvaluationRequest,
} from "../../src/capability-packs/index.js";
import { SkillError, SkillRegistry } from "../../src/skills/index.js";

const T0 = "2026-09-04T09:00:00.000Z";
const T1 = "2026-09-04T10:00:00.000Z";

class FixtureAuthority {
  calls = 0;
  readonly #factory: (request: CapabilityEvaluationRequest) => unknown;

  constructor(factory: (request: CapabilityEvaluationRequest) => unknown) {
    this.#factory = factory;
  }

  async evaluate(request: CapabilityEvaluationRequest): Promise<unknown> {
    this.calls += 1;
    return this.#factory(request);
  }
}

function registerCandidate(skills: SkillRegistry, overrides: Record<string, unknown> = {}) {
  return skills.registerCandidate({
    instructions:
      "Reframe a consequential research question into falsifiable hypotheses and search for disconfirming evidence before synthesis.",
    name: "research-hypothesis",
    provenance: {
      kind: "community",
      observedAt: T0,
      reference: "github:example/research@abc123:skills/research",
    },
    requiredTools: [],
    summary: "Hypothesis and opposition-query research discipline.",
    tags: ["research", "triangulation"],
    testRefs: ["m14:report:abc123"],
    trustClass: "community",
    version: "gabc123def456",
    ...overrides,
  });
}

function request(
  record: ReturnType<typeof registerCandidate>,
  overrides: Record<string, unknown> = {},
) {
  return {
    candidate: {
      contentHash: record.package.contentHash,
      name: record.package.name,
      version: record.package.version,
    },
    domain: "research",
    observedAt: T1,
    procedureKeys: ["research.falsifiable-hypotheses", "verification.evidence-binding"],
    taskClasses: ["research-decision", "research-validation"],
    ...overrides,
  };
}

function measurement(overrides: Record<string, unknown> = {}) {
  return {
    authority: "PASS",
    latencyMs: 120,
    qualityBps: 8_500,
    safety: "PASS",
    totalTokens: 1_000,
    ...overrides,
  };
}

function attestation(
  evaluationRequest: CapabilityEvaluationRequest,
  overrides: Record<string, unknown> = {},
) {
  return {
    candidate: evaluationRequest.candidate,
    cases: [
      {
        baseline: measurement({ qualityBps: 8_000, totalTokens: 900 }),
        candidate: measurement({ qualityBps: 8_500, totalTokens: 1_000 }),
        evidenceRef: "heldout:research:case-a",
        id: "case-a",
        maxCandidateLatencyMs: 500,
        maxCandidateTokens: 1_500,
        requiredQualityBps: 8_000,
        taskClass: "research-decision",
      },
      {
        baseline: measurement({ qualityBps: 8_100, totalTokens: 950 }),
        candidate: measurement({ qualityBps: 8_350, totalTokens: 1_050 }),
        evidenceRef: "heldout:research:case-b",
        id: "case-b",
        maxCandidateLatencyMs: 500,
        maxCandidateTokens: 1_500,
        requiredQualityBps: 8_000,
        taskClass: "research-validation",
      },
    ],
    domain: evaluationRequest.domain,
    evaluatedAt: T1,
    producerClass: "independent_test",
    ...overrides,
  };
}

test("novel independently passing candidate becomes VERIFIED but never ACTIVE", async () => {
  const skills = new SkillRegistry();
  const candidate = registerCandidate(skills);
  const authority = new FixtureAuthority((value) => attestation(value));
  const curator = new CapabilityCurator(skills, authority, ["verification.evidence-binding"]);

  const result = await curator.curate(request(candidate));

  assert.equal(authority.calls, 1);
  assert.equal(result.report.decision, "PASS");
  assert.deepEqual(result.report.novelProcedureKeys, ["research.falsifiable-hypotheses"]);
  assert.equal(result.report.totalLiftBps, 750);
  assert.equal(result.report.cases.length, 2);
  assert.ok(result.verified);
  assert.equal(result.verified.lifecycle, "VERIFIED");
  assert.equal(
    skills.resolve(candidate.package.name, candidate.package.version).contentHash,
    candidate.package.contentHash,
  );
  assert.throws(
    () => skills.resolveActive(candidate.package.name),
    (error: unknown) => error instanceof SkillError && error.code === "NOT_FOUND",
  );
});

test("fully redundant procedure stops before evaluation and keeps candidate unprivileged", async () => {
  const skills = new SkillRegistry();
  const candidate = registerCandidate(skills);
  const authority = new FixtureAuthority((value) => attestation(value));
  const curator = new CapabilityCurator(skills, authority, [
    "research.falsifiable-hypotheses",
    "verification.evidence-binding",
  ]);

  const result = await curator.curate(request(candidate));

  assert.equal(result.report.decision, "REDUNDANT");
  assert.deepEqual(result.report.reasons, ["NO_NOVEL_PROCEDURE"]);
  assert.equal(authority.calls, 0);
  assert.equal(
    skills.resolveForReview(candidate.package.name, candidate.package.version).lifecycle,
    "CANDIDATE",
  );
});

test("quality safety authority token and latency regressions never verify", async () => {
  const variants = [
    { candidate: measurement({ qualityBps: 7_900 }), expected: "QUALITY_REGRESSION" },
    { candidate: measurement({ safety: "FAIL" }), expected: "SAFETY" },
    { candidate: measurement({ authority: "FAIL" }), expected: "AUTHORITY" },
    { candidate: measurement({ totalTokens: 2_000 }), expected: "TOKEN_LIMIT" },
    { candidate: measurement({ latencyMs: 700 }), expected: "LATENCY_LIMIT" },
  ] as const;

  for (const variant of variants) {
    const skills = new SkillRegistry();
    const candidate = registerCandidate(skills);
    const authority = new FixtureAuthority((value) => {
      const base = attestation(value) as {
        candidate: unknown;
        cases: Array<Record<string, unknown>>;
        domain: unknown;
        evaluatedAt: string;
        producerClass: string;
      };
      return {
        ...base,
        cases: base.cases.map((entry, index) =>
          index === 0 ? { ...entry, candidate: variant.candidate } : entry,
        ),
      };
    });
    const curator = new CapabilityCurator(skills, authority, ["verification.evidence-binding"]);

    const result = await curator.curate(request(candidate));

    assert.equal(result.report.decision, "FAIL");
    assert.ok(result.report.reasons.some((reason) => reason.includes(variant.expected)));
    assert.equal(
      skills.resolveForReview(candidate.package.name, candidate.package.version).lifecycle,
      "CANDIDATE",
    );
  }
});

test("average lift floor is monotonic and cannot be offset by lower cost", async () => {
  const skills = new SkillRegistry();
  const candidate = registerCandidate(skills);
  const authority = new FixtureAuthority((value) => {
    const base = attestation(value) as {
      cases: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    return {
      ...base,
      cases: base.cases.map((entry) => ({
        ...entry,
        baseline: measurement({ qualityBps: 8_000, totalTokens: 1_400 }),
        candidate: measurement({ qualityBps: 8_050, totalTokens: 200 }),
      })),
    };
  });
  const curator = new CapabilityCurator(skills, authority, ["verification.evidence-binding"], {
    minAverageLiftBps: 100,
  });

  const result = await curator.curate(request(candidate));

  assert.equal(result.report.decision, "FAIL");
  assert.ok(result.report.reasons.includes("AVERAGE_LIFT_BELOW_FLOOR"));
  assert.equal(
    skills.resolveForReview(candidate.package.name, candidate.package.version).lifecycle,
    "CANDIDATE",
  );
});

test("foreign stale and self-authored evaluation evidence fails closed", async () => {
  const cases = [
    (value: CapabilityEvaluationRequest) =>
      attestation(value, {
        candidate: { ...value.candidate, contentHash: "f".repeat(64) },
      }),
    (value: CapabilityEvaluationRequest) =>
      attestation(value, { evaluatedAt: "2026-08-01T00:00:00.000Z" }),
    (value: CapabilityEvaluationRequest) => attestation(value, { producerClass: "model" }),
  ];

  for (const factory of cases) {
    const skills = new SkillRegistry();
    const candidate = registerCandidate(skills);
    const curator = new CapabilityCurator(skills, new FixtureAuthority(factory), [
      "verification.evidence-binding",
    ]);

    await assert.rejects(
      () => curator.curate(request(candidate)),
      (error: unknown) =>
        error instanceof CapabilityCurationError && error.code === "EVALUATION_FAILED",
    );
    assert.equal(
      skills.resolveForReview(candidate.package.name, candidate.package.version).lifecycle,
      "CANDIDATE",
    );
  }
});

test("candidate hash mismatch and non-community lifecycle are denied before evaluation", async () => {
  const skills = new SkillRegistry();
  const candidate = registerCandidate(skills);
  const authority = new FixtureAuthority((value) => attestation(value));
  const curator = new CapabilityCurator(skills, authority, ["verification.evidence-binding"]);

  await assert.rejects(
    () =>
      curator.curate(
        request(candidate, {
          candidate: { ...request(candidate).candidate, contentHash: "0".repeat(64) },
        }),
      ),
    (error: unknown) => error instanceof CapabilityCurationError && error.code === "CONFLICT",
  );
  assert.equal(authority.calls, 0);

  const projectSkills = new SkillRegistry();
  const trusted = projectSkills.registerTrusted({
    instructions: "Project-owned procedure.",
    name: "project-procedure",
    provenance: { kind: "project", observedAt: T0, reference: "project:procedure" },
    requiredTools: [],
    summary: "Project procedure.",
    tags: ["project"],
    testRefs: ["project:test"],
    trustClass: "project",
    version: "v1",
  });
  const trustedAuthority = new FixtureAuthority((value) => attestation(value));
  const trustedCurator = new CapabilityCurator(projectSkills, trustedAuthority, [
    "verification.evidence-binding",
  ]);
  await assert.rejects(
    () =>
      trustedCurator.curate({
        ...request(candidate),
        candidate: {
          contentHash: trusted.package.contentHash,
          name: trusted.package.name,
          version: trusted.package.version,
        },
      }),
    (error: unknown) => error instanceof CapabilityCurationError && error.code === "DENIED",
  );
  assert.equal(trustedAuthority.calls, 0);
});

test("case ordering cannot change curation report identity", async () => {
  const make = async (reverse: boolean) => {
    const skills = new SkillRegistry();
    const candidate = registerCandidate(skills);
    const authority = new FixtureAuthority((value) => {
      const result = attestation(value) as { cases: readonly unknown[]; [key: string]: unknown };
      return { ...result, cases: reverse ? [...result.cases].reverse() : result.cases };
    });
    const curator = new CapabilityCurator(skills, authority, ["verification.evidence-binding"]);
    return curator.curate(request(candidate));
  };

  const forward = await make(false);
  const reversed = await make(true);

  assert.equal(forward.report.reportHash, reversed.report.reportHash);
  assert.deepEqual(forward.report.cases, reversed.report.cases);
});

test("malformed duplicate and incomplete held-out cases fail closed", async () => {
  const factories = [
    (value: CapabilityEvaluationRequest) => {
      const result = attestation(value) as { cases: readonly unknown[]; [key: string]: unknown };
      return { ...result, cases: [result.cases[0], result.cases[0]] };
    },
    (value: CapabilityEvaluationRequest) => {
      const result = attestation(value) as { cases: readonly unknown[]; [key: string]: unknown };
      return { ...result, cases: [result.cases[0]] };
    },
  ];

  for (const factory of factories) {
    const skills = new SkillRegistry();
    const candidate = registerCandidate(skills);
    const curator = new CapabilityCurator(skills, new FixtureAuthority(factory), [
      "verification.evidence-binding",
    ]);
    await assert.rejects(
      () => curator.curate(request(candidate)),
      (error: unknown) => error instanceof CapabilityCurationError,
    );
  }
});

test("context ceiling blocks evaluation without converting size pressure into trust", async () => {
  const skills = new SkillRegistry();
  const candidate = registerCandidate(skills, { instructions: "A".repeat(512) });
  const authority = new FixtureAuthority((value) => attestation(value));
  const curator = new CapabilityCurator(skills, authority, ["verification.evidence-binding"], {
    maxContextBytes: 128,
  });

  const result = await curator.curate(request(candidate));

  assert.equal(result.report.decision, "FAIL");
  assert.deepEqual(result.report.reasons, ["CONTEXT_LIMIT"]);
  assert.equal(authority.calls, 0);
  assert.equal(
    skills.resolveForReview(candidate.package.name, candidate.package.version).lifecycle,
    "CANDIDATE",
  );
});
