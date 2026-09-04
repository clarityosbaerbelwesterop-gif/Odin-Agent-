import assert from "node:assert/strict";
import { test } from "node:test";
import { containsObviousSecret } from "../../src/security/secret-text.js";

test("obvious credential patterns are detected without flagging ordinary prose", () => {
  assert.equal(containsObviousSecret("Bearer abcdefghijklmnop"), true);
  assert.equal(containsObviousSecret("sk-proj-abcdefghijk12345"), true);
  assert.equal(containsObviousSecret("ghp_abcdefghijk12345"), true);
  assert.equal(containsObviousSecret("xoxb-123456789"), true);
  assert.equal(containsObviousSecret("-----BEGIN PRIVATE KEY-----"), true);
  assert.equal(containsObviousSecret("Use scoped verification evidence before promotion."), false);
});
