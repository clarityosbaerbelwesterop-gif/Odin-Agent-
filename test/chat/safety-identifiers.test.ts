import assert from "node:assert/strict";
import test from "node:test";
import { identifier } from "../../src/chat/safety.js";

test("durable bot specialist request ids accept bounded colon-separated components", () => {
  const value = "d2ce4d52-980a-47b7-825c-b91542b9456b:odin_security:preflight";
  assert.equal(identifier(value), value);
});

test("identifiers still reject unsafe separators and overlong values", () => {
  assert.throws(() => identifier("task/id"), /Invalid identifier/u);
  assert.throws(() => identifier("task.id"), /Invalid identifier/u);
  assert.throws(() => identifier("x".repeat(101)), /Invalid identifier/u);
});
