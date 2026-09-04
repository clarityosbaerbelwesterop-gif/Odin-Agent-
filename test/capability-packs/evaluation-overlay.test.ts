import assert from "node:assert/strict";
import test from "node:test";
import { CandidateEvaluationProvider } from "../../src/capability-packs/index.js";
import type { ModelRequest } from "../../src/providers/types.js";
import { modelResponse, ScriptedProvider } from "../runtime/coding-fixtures.js";

const HASH = "a".repeat(64);

function request(): ModelRequest {
  return {
    maxOutputTokens: 512,
    messages: [
      { content: [{ text: "Canonical runtime policy.", type: "text" }], role: "system" },
      { content: [{ text: "Repository evidence.", type: "text" }], role: "user" },
    ],
    model: "fixture-model",
    responseFormat: { type: "json_object" },
  };
}

test("evaluation overlay adds bounded lower-trust guidance without mutating canonical request fields", async () => {
  const base = new ScriptedProvider([modelResponse({ ok: true }, 10, 2)]);
  const overlay = new CandidateEvaluationProvider(base, {
    candidateContentHash: HASH,
    instructions: "Prefer evidence-grounded minimal changes.",
    sourceReference: "m15:test:candidate",
  });
  const original = request();

  await overlay.generate(original);

  assert.equal(overlay.id, base.id);
  assert.equal(base.requests.length, 1);
  const seen = base.requests[0];
  assert.ok(seen);
  assert.equal(seen.model, original.model);
  assert.deepEqual(seen.responseFormat, original.responseFormat);
  assert.equal(seen.maxOutputTokens, original.maxOutputTokens);
  assert.equal(seen.messages.length, original.messages.length + 1);
  assert.deepEqual(seen.messages.slice(0, 2), original.messages);
  const guidance = seen.messages.at(-1);
  assert.equal(guidance?.role, "user");
  assert.equal("toolCalls" in (guidance ?? {}), false);
  if (guidance?.role !== "user") assert.fail("Expected user-role evaluation guidance.");
  const content = guidance.content[0];
  assert.equal(content?.type, "text");
  if (content?.type !== "text") assert.fail("Expected text guidance.");
  const parsed = JSON.parse(content.text) as Record<string, unknown>;
  assert.deepEqual(parsed, {
    candidateContentHash: HASH,
    instructions: "Prefer evidence-grounded minimal changes.",
    sourceReference: "m15:test:candidate",
    trust: "evaluation-only-untrusted-procedure",
  });
  assert.deepEqual(original, request());
});

test("evaluation overlay cannot smuggle malformed identity or unbounded instructions", () => {
  const base = new ScriptedProvider([]);
  assert.throws(
    () =>
      new CandidateEvaluationProvider(base, {
        candidateContentHash: "bad",
        instructions: "Procedure.",
        sourceReference: "m15:test",
      }),
    TypeError,
  );
  assert.throws(
    () =>
      new CandidateEvaluationProvider(base, {
        candidateContentHash: HASH,
        instructions: "x".repeat(33),
        maxInstructionBytes: 32,
        sourceReference: "m15:test",
      }),
    TypeError,
  );
  assert.throws(
    () =>
      new CandidateEvaluationProvider(base, {
        candidateContentHash: HASH,
        instructions: "Procedure.",
        maxInstructionBytes: 0,
        sourceReference: "m15:test",
      }),
    TypeError,
  );
});
