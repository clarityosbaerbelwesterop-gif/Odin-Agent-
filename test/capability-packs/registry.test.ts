import assert from "node:assert/strict";
import test from "node:test";
import {
  CapabilityCurator,
  type CapabilityEvaluationRequest,
  CapabilityPackError,
  CapabilityPackRegistry,
} from "../../src/capability-packs/index.js";
import { SkillRegistry } from "../../src/skills/index.js";

const T0 = "2026-09-04T09:00:00.000Z";
const T1 = "2026-09-04T10:00:00.000Z";

class PassingAuthority {
  async evaluate(request: CapabilityEvaluationRequest): Promise<unknown> {
    return {
      candidate: request.candidate,
      cases: [
        {
          baseline: {
            authority: "PASS",
            latencyMs: 100,
            qualityBps: 8_000,
            safety: "PASS",
            totalTokens: 900,
          },
          candidate: {
            authority: "PASS",
            latencyMs: 110,
            qualityBps: 8_400,
            safety: "PASS",
            totalTokens: 1_000,
          },
          evidenceRef: "heldout:security:case-a",
          id: "case-a",
          maxCandidateLatencyMs: 500,
          maxCandidateTokens: 1_500,
          requiredQualityBps: 8_000,
          taskClass: "security-review",
        },
      ],
      domain: request.domain,
      evaluatedAt: T1,
      producerClass: "independent_test",
    };
  }
}

function makeCurator(
  skills: SkillRegistry,
  authority: PassingAuthority,
  canonicalProcedureKeys: readonly string[],
) {
  return new CapabilityCurator(skills, authority, canonicalProcedureKeys, {}, () => T1);
}

async function measuredSecuritySkill() {
  const skills = new SkillRegistry();
  const candidate = skills.registerCandidate({
    instructions:
      "Review changed attack surfaces, trace concrete exploit paths, and filter speculative findings before reporting.",
    name: "security-diff-review",
    provenance: {
      kind: "community",
      observedAt: T0,
      reference: "github:example/security@abc123:skill",
    },
    requiredTools: [],
    summary: "Diff-aware concrete security review.",
    tags: ["security", "review"],
    testRefs: ["m14:security:abc123"],
    trustClass: "community",
    version: "gabc123def456",
  });
  const curator = makeCurator(skills, new PassingAuthority(), ["verification.evidence-binding"]);
  const result = await curator.curate({
    candidate: {
      contentHash: candidate.package.contentHash,
      name: candidate.package.name,
      version: candidate.package.version,
    },
    domain: "security",
    observedAt: T1,
    procedureKeys: ["security.diff-aware-attack-surface", "verification.evidence-binding"],
    taskClasses: ["security-review"],
  });
  assert.equal(result.report.decision, "PASS");
  return { candidate, report: result.report, skills };
}

function packInput(
  measured: Awaited<ReturnType<typeof measuredSecuritySkill>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    domain: "security",
    id: "security-core",
    members: [
      {
        contentHash: measured.candidate.package.contentHash,
        curationReportHash: measured.report.reportHash,
        name: measured.candidate.package.name,
        taskClasses: ["security-review"],
        version: measured.candidate.package.version,
      },
    ],
    version: "v1",
    ...overrides,
  };
}

test("measured VERIFIED member registers into compact progressive pack", async () => {
  const measured = await measuredSecuritySkill();
  const packs = new CapabilityPackRegistry(measured.skills, [measured.report]);

  const pack = packs.register(packInput(measured));
  const summaries = packs.listSummaries();

  assert.equal(pack.domain, "security");
  assert.equal(pack.members.length, 1);
  assert.ok(pack.contextBytes > 0);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.memberCount, 1);
  assert.equal("instructions" in (summaries[0] ?? {}), false);
  const resolved = packs.resolveMember(
    pack.id,
    pack.version,
    measured.candidate.package.name,
    measured.candidate.package.version,
  );
  assert.equal(resolved.contentHash, measured.candidate.package.contentHash);
});

test("pack rejects missing forged failed or foreign curation evidence", async () => {
  const measured = await measuredSecuritySkill();
  const missing = new CapabilityPackRegistry(measured.skills, []);
  assert.throws(
    () => missing.register(packInput(measured)),
    (error: unknown) => error instanceof CapabilityPackError && error.code === "DENIED",
  );

  assert.throws(
    () => new CapabilityPackRegistry(measured.skills, [{ ...measured.report, decision: "FAIL" }]),
    (error: unknown) => error instanceof CapabilityPackError && error.code === "DENIED",
  );

  const foreign = new CapabilityPackRegistry(measured.skills, [measured.report]);
  assert.throws(
    () => foreign.register(packInput(measured, { domain: "research" })),
    (error: unknown) => error instanceof CapabilityPackError && error.code === "CONFLICT",
  );
});

test("M10 lifecycle and exact content hash remain pack authority boundary", async () => {
  const measured = await measuredSecuritySkill();
  const source = measured.candidate.package;
  const candidateSkills = new SkillRegistry();
  const candidate = candidateSkills.registerCandidate({
    instructions: source.instructions,
    name: source.name,
    provenance: source.provenance,
    requiredTools: source.requiredTools,
    summary: source.summary,
    tags: source.tags,
    testRefs: source.testRefs,
    trustClass: source.trustClass,
    version: source.version,
  });
  const packs = new CapabilityPackRegistry(candidateSkills, [measured.report]);

  assert.throws(
    () =>
      packs.register({
        ...packInput(measured),
        members: [
          {
            contentHash: candidate.package.contentHash,
            curationReportHash: measured.report.reportHash,
            name: candidate.package.name,
            taskClasses: ["security-review"],
            version: candidate.package.version,
          },
        ],
      }),
    (error: unknown) => error instanceof CapabilityPackError && error.code === "DENIED",
  );

  const verifiedPacks = new CapabilityPackRegistry(measured.skills, [measured.report]);
  assert.throws(
    () =>
      verifiedPacks.register({
        ...packInput(measured),
        members: [
          {
            ...packInput(measured).members[0],
            contentHash: "0".repeat(64),
          },
        ],
      }),
    (error: unknown) => error instanceof CapabilityPackError && error.code === "CONFLICT",
  );
});

test("pack member task classes and context ceilings fail closed", async () => {
  const measured = await measuredSecuritySkill();
  const packs = new CapabilityPackRegistry(measured.skills, [measured.report]);
  assert.throws(
    () =>
      packs.register({
        ...packInput(measured),
        members: [
          {
            ...packInput(measured).members[0],
            taskClasses: ["foreign-task"],
          },
        ],
      }),
    (error: unknown) => error instanceof CapabilityPackError && error.code === "CONFLICT",
  );

  const tiny = new CapabilityPackRegistry(measured.skills, [measured.report], {
    maxContextBytes: 16,
  });
  assert.throws(
    () => tiny.register(packInput(measured)),
    (error: unknown) => error instanceof CapabilityPackError && error.code === "DENIED",
  );
});

test("pack identity is deterministic across member order", async () => {
  const first = await measuredSecuritySkill();
  const skills = first.skills;
  const secondCandidate = skills.registerCandidate({
    instructions: "Report only concrete security findings with an explicit exploit path.",
    name: "security-exploit-path",
    provenance: {
      kind: "community",
      observedAt: T0,
      reference: "github:example/security@def456:skill",
    },
    requiredTools: [],
    summary: "Concrete exploit-path filtering.",
    tags: ["security", "exploit"],
    testRefs: ["m14:security:def456"],
    trustClass: "community",
    version: "gdef456abc123",
  });
  const curator = makeCurator(skills, new PassingAuthority(), ["verification.evidence-binding"]);
  const second = await curator.curate({
    candidate: {
      contentHash: secondCandidate.package.contentHash,
      name: secondCandidate.package.name,
      version: secondCandidate.package.version,
    },
    domain: "security",
    observedAt: T1,
    procedureKeys: ["security.concrete-exploit-path"],
    taskClasses: ["security-review"],
  });
  assert.equal(second.report.decision, "PASS");

  const members = [
    packInput(first).members[0],
    {
      contentHash: secondCandidate.package.contentHash,
      curationReportHash: second.report.reportHash,
      name: secondCandidate.package.name,
      taskClasses: ["security-review"],
      version: secondCandidate.package.version,
    },
  ];
  const forward = new CapabilityPackRegistry(skills, [first.report, second.report]).register({
    domain: "security",
    id: "security-core",
    members,
    version: "v1",
  });
  const reversed = new CapabilityPackRegistry(skills, [first.report, second.report]).register({
    domain: "security",
    id: "security-core",
    members: [...members].reverse(),
    version: "v1",
  });

  assert.equal(forward.packHash, reversed.packHash);
  assert.deepEqual(forward.members, reversed.members);
});
