import assert from "node:assert/strict";
import test from "node:test";
import {
  capabilityCurationReportHash,
  type CapabilityCurationReport,
  CapabilityPackError,
  CapabilityPackRegistry,
} from "../../src/capability-packs/index.js";
import { SkillRegistry } from "../../src/skills/index.js";

const T0 = "2026-09-04T09:00:00.000Z";
const T1 = "2026-09-04T10:00:00.000Z";

function verifiedWithUnrelatedEvidence() {
  const skills = new SkillRegistry();
  const candidate = skills.registerCandidate({
    instructions: "Review only concrete changed attack surfaces with evidence.",
    name: "security-evidence-bound",
    provenance: {
      kind: "community",
      observedAt: T0,
      reference: "github:example/security@abc123:skill",
    },
    requiredTools: [],
    summary: "Evidence-bound security review.",
    tags: ["security"],
    testRefs: ["m14:security:abc123"],
    trustClass: "community",
    version: "v1",
  });
  skills.verify({
    contentHash: candidate.package.contentHash,
    evidenceRefs: ["heldout:unrelated"],
    name: candidate.package.name,
    observedAt: T1,
    producerClass: "independent_test",
    status: "PASS",
    version: candidate.package.version,
  });
  return { candidate, skills };
}

function passingReport(
  candidate: ReturnType<typeof verifiedWithUnrelatedEvidence>["candidate"],
  overrides: Partial<CapabilityCurationReport> = {},
): CapabilityCurationReport {
  const value: CapabilityCurationReport = {
    candidate: {
      contentHash: candidate.package.contentHash,
      name: candidate.package.name,
      version: candidate.package.version,
    },
    candidateContextBytes: Buffer.byteLength(candidate.package.instructions, "utf8"),
    cases: [
      {
        candidateQualityBps: 8_500,
        evidenceRef: "heldout:measured",
        id: "case-a",
        liftBps: 400,
        passed: true,
        taskClass: "security-review",
      },
    ],
    decision: "PASS",
    domain: "security",
    evaluatedAt: T1,
    evidenceRefs: ["heldout:measured"],
    novelProcedureKeys: ["security.concrete-exploit-path"],
    procedureKeys: ["security.concrete-exploit-path"],
    reasons: [],
    reportHash: "0".repeat(64),
    taskClasses: ["security-review"],
    totalLiftBps: 400,
    ...overrides,
  };
  return { ...value, reportHash: capabilityCurationReportHash(value) };
}

test("pack rejects a skill verified by evidence unrelated to the M15 passing report", () => {
  const { candidate, skills } = verifiedWithUnrelatedEvidence();
  const report = passingReport(candidate);
  const packs = new CapabilityPackRegistry(skills, [report]);

  assert.throws(
    () =>
      packs.register({
        domain: "security",
        id: "security-core",
        members: [
          {
            contentHash: candidate.package.contentHash,
            curationReportHash: report.reportHash,
            name: candidate.package.name,
            taskClasses: ["security-review"],
            version: candidate.package.version,
          },
        ],
        version: "v1",
      }),
    (error: unknown) => error instanceof CapabilityPackError && error.code === "DENIED",
  );
});

test("hash-valid but semantically inconsistent PASS reports are denied", () => {
  const { candidate, skills } = verifiedWithUnrelatedEvidence();
  const inconsistent = passingReport(candidate, { totalLiftBps: 999 });

  assert.throws(
    () => new CapabilityPackRegistry(skills, [inconsistent]),
    (error: unknown) => error instanceof CapabilityPackError && error.code === "DENIED",
  );
});
