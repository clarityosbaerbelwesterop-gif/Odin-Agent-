import assert from "node:assert/strict";
import test from "node:test";
import {
  M15_ADDITIVE_PROCEDURE_KEYS,
  M15_DISTILLED_CAPABILITY_DRAFTS,
  ODIN_CANONICAL_PROCEDURE_KEYS,
} from "../../src/capability-packs/index.js";
import { normalizePackage, SkillRegistry } from "../../src/skills/index.js";

test("distilled procedures remain unregistered project drafts with no execution authority", () => {
  const skills = new SkillRegistry();
  const names = new Set<string>();

  for (const draft of M15_DISTILLED_CAPABILITY_DRAFTS) {
    assert.equal(draft.package.trustClass, "project");
    assert.equal(draft.package.provenance.kind, "project");
    assert.deepEqual(draft.package.requiredTools, []);
    assert.ok(draft.sourceRefs.length > 0);
    assert.ok(draft.taskClasses.length > 0);
    assert.ok(draft.procedureKeys.length > 0);
    assert.equal(names.has(draft.package.name), false);
    names.add(draft.package.name);

    const normalized = normalizePackage(draft.package);
    assert.match(normalized.contentHash, /^[a-f0-9]{64}$/u);
  }

  assert.deepEqual(skills.listReviewSummaries(), []);
});

test("distilled procedure keys are additive and do not relabel canonical Odin behavior", () => {
  const canonical = new Set<string>(ODIN_CANONICAL_PROCEDURE_KEYS);

  for (const draft of M15_DISTILLED_CAPABILITY_DRAFTS) {
    const allowed = new Set<string>(M15_ADDITIVE_PROCEDURE_KEYS[draft.domain]);
    for (const key of draft.procedureKeys) {
      assert.equal(canonical.has(key), false);
      assert.equal(allowed.has(key), true);
    }
  }
});

test("unproven data-document pack stays absent instead of being filled speculatively", () => {
  assert.equal(
    M15_DISTILLED_CAPABILITY_DRAFTS.some((draft) => draft.domain === "data-documents"),
    false,
  );
});
