import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MODE_POLICIES } from "../../src/chat/modes.js";
import { MODE_MINIMUM_PLAN, planAllows } from "../../src/chat/product.js";

const root = process.cwd();

test("Coding proves value on free while premium tiers can still differentiate by quota", () => {
  assert.equal(MODE_MINIMUM_PLAN.coding, "free");
  assert.equal(planAllows("free", MODE_MINIMUM_PLAN.coding), true);
  assert.equal(MODE_POLICIES.coding.plan, true);
  assert.equal(MODE_POLICIES.coding.review, false);
  assert.equal(MODE_POLICIES.coding.calls, 12);
});

test("production reconciliation includes Product Workspace, Memory and Skills schemas", async () => {
  const source = await readFile(`${root}/scripts/configure-vercel-production.mjs`, "utf8");
  for (const migration of [
    "012_product_m2_workspace_os.sql",
    "013_product_m3_memory_brain.sql",
    "014_product_m5_skills_os.sql",
  ])
    assert.match(source, new RegExp(migration.replaceAll(".", "\\."), "u"));
});

test("tool visibility emits bounded public summaries rather than raw patch content", async () => {
  const source = await readFile(`${root}/src/chat/agent.ts`, "utf8");
  assert.match(source, /visibleToolInput/u);
  assert.match(source, /contentBytes/u);
  assert.match(source, /visibleToolResult/u);
  assert.doesNotMatch(source, /input:\s*tool\.arguments\s*[,}]/u);
});
