import assert from "node:assert/strict";
import test from "node:test";
import { SkillIntakeFirewall } from "../../src/skill-intake/index.js";
import { SkillRegistry } from "../../src/skills/index.js";

const SKILL_PATH = "skills/reviewed";
const SKILL = `---
name: reviewed
description: "Review bounded evidence."
---

# Reviewed

Use only runtime-approved capabilities.
`;

class Resolver {
  async resolve(): Promise<unknown> {
    return {
      commitSha: "d".repeat(40),
      files: [
        { content: SKILL, kind: "text", path: `${SKILL_PATH}/SKILL.md` },
        {
          content: "name: untrusted\non: push\njobs: {}\n",
          kind: "text",
          path: `${SKILL_PATH}/.github/workflows/untrusted.yml`,
        },
      ],
      inventoryComplete: true,
      license: { path: "LICENSE", spdx: "MIT" },
      ref: "main",
      repository: "example/workflow-skill",
      skillPath: SKILL_PATH,
    };
  }
}

test("nested .github workflow surface is quarantined", async () => {
  const firewall = new SkillIntakeFirewall(new Resolver(), new SkillRegistry());
  const result = await firewall.intake({
    observedAt: "2026-09-04T09:31:00.000Z",
    ref: "main",
    repository: "example/workflow-skill",
    skillPath: SKILL_PATH,
  });

  assert.equal(result.report.completeness, "COMPLETE");
  assert.equal(result.report.decision, "QUARANTINE");
  assert.equal(result.candidate, undefined);
  assert.ok(result.report.findings.some((finding) => finding.ruleId === "HOOK_WORKFLOW"));
});
