import assert from "node:assert/strict";
import test from "node:test";
import { MissionDomainError } from "../../src/mission/runtime.js";
import type { ModelRequest } from "../../src/providers/types.js";
import {
  CODING_PLAN_SCHEMA,
  CODING_REPAIR_SCHEMA,
  planPrompt,
  type RepositoryDiscovery,
  type RepositoryFileEvidence,
  repairPrompt,
} from "../../src/runtime/coding-contract.js";
import { GroundedCodingProvider } from "../../src/runtime/grounded-coding-provider.js";
import { modelResponse, ScriptedProvider } from "./coding-fixtures.js";

const OBJECTIVE = "Canonicalize selectUserId using the existing helper.";
const TARGET_SHA = "a".repeat(64);
const TARGET_CONTENT =
  'import { canonicalizeId } from "./identity.js";\n\nexport function selectUserId(value: string): string {\n  return value;\n}\n';
const FIXED_CONTENT =
  'import { canonicalizeId } from "./identity.js";\n\nexport function selectUserId(value: string): string {\n  return canonicalizeId(value);\n}\n';

function discovery(): RepositoryDiscovery {
  return {
    packageJson: JSON.stringify({ name: "grounded-test", private: true }),
    qualityCommandIds: ["verify"],
    query: "canonicalize",
    relevantFiles: [
      {
        content: TARGET_CONTENT,
        path: "src/user.ts",
        sha: TARGET_SHA,
        truncated: false,
      },
      {
        content:
          "export function canonicalizeId(value: string): string { return value.trim().toLowerCase(); }\n",
        path: "src/identity.ts",
        sha: "b".repeat(64),
        truncated: false,
      },
    ],
  };
}

function planRequest(repository: RepositoryDiscovery): ModelRequest {
  return {
    maxOutputTokens: 3_072,
    messages: [
      {
        content: [{ text: "Return only strict JSON.", type: "text" }],
        role: "system",
      },
      {
        content: [{ text: planPrompt(OBJECTIVE, repository), type: "text" }],
        role: "user",
      },
    ],
    model: "fixture-model",
    responseFormat: {
      name: "odin_m4_coding_plan",
      schema: CODING_PLAN_SCHEMA,
      strict: true,
      type: "json_schema",
    },
  };
}

function responseFormatName(request: ModelRequest | undefined): string | undefined {
  return request?.responseFormat?.type === "json_schema" ? request.responseFormat.name : undefined;
}

function requestText(request: ModelRequest | undefined): string {
  if (request === undefined) return "";
  return request.messages
    .flatMap((message) => (message.role === "tool" ? [] : message.content))
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

test("grounded planning removes model-owned SHA/task metadata and rebinds trusted values", async () => {
  const inner = new ScriptedProvider([
    modelResponse(
      {
        change: { content: FIXED_CONTENT, path: "src/user.ts" },
        qualityCommandId: "verify",
      },
      50,
      20,
    ),
  ]);
  const provider = new GroundedCodingProvider(inner);
  const request = planRequest(discovery());

  const response = await provider.generate(request);
  assert.equal(inner.requests.length, 1);
  const sent = inner.requests[0];
  assert.equal(responseFormatName(sent), "odin_grounded_coding_plan_v1");
  assert.ok((sent?.maxOutputTokens ?? 10_000) < 3_072);
  const sentText = requestText(sent);
  assert.equal(sentText.includes(TARGET_SHA), false);
  assert.equal(sentText.includes("packageJson"), false);
  assert.equal(sentText.includes("expectedSha"), false);

  const output = response.structuredOutput as Record<string, unknown>;
  const change = output.change as Record<string, unknown>;
  const task = output.task as Record<string, unknown>;
  assert.equal(change.path, "src/user.ts");
  assert.equal(change.expectedSha, TARGET_SHA);
  assert.equal(change.content, FIXED_CONTENT);
  assert.equal(output.qualityCommandId, "verify");
  assert.deepEqual(task.dependsOn, []);
  assert.deepEqual(task.definitionOfDone, [OBJECTIVE]);
  assert.equal(task.priority, 10);
  assert.match(String(task.id), /^change-[a-f0-9]{20}$/u);
  assert.equal(responseFormatName(request), "odin_m4_coding_plan");
});

test("grounded repair asks only for replacement content and restores runtime path plus SHA", async () => {
  const current: RepositoryFileEvidence = {
    content: TARGET_CONTENT,
    path: "src/user.ts",
    sha: TARGET_SHA,
    truncated: false,
  };
  const inner = new ScriptedProvider([modelResponse({ content: FIXED_CONTENT }, 35, 15)]);
  const provider = new GroundedCodingProvider(inner);
  const request: ModelRequest = {
    maxOutputTokens: 2_048,
    messages: [
      { content: [{ text: "Repair.", type: "text" }], role: "system" },
      {
        content: [
          {
            text: repairPrompt(
              OBJECTIVE,
              current.path,
              current,
              "verify",
              "quality:verify:exit:1:sha256:abc",
              "deterministic acceptance failed",
            ),
            type: "text",
          },
        ],
        role: "user",
      },
    ],
    model: "fixture-model",
    responseFormat: {
      name: "odin_m4_coding_repair",
      schema: CODING_REPAIR_SCHEMA,
      strict: true,
      type: "json_schema",
    },
  };

  const response = await provider.generate(request);
  const sent = inner.requests[0];
  assert.equal(responseFormatName(sent), "odin_grounded_coding_repair_v1");
  const sentText = requestText(sent);
  assert.equal(sentText.includes(TARGET_SHA), false);
  assert.equal(sentText.includes("failureSignature"), false);
  assert.deepEqual(response.structuredOutput, {
    content: FIXED_CONTENT,
    expectedSha: TARGET_SHA,
    path: "src/user.ts",
  });
});

test("grounded provider rejects a model-selected path outside trusted discovery", async () => {
  const inner = new ScriptedProvider([
    modelResponse(
      {
        change: { content: "export const compromised = true;\n", path: "src/other.ts" },
        qualityCommandId: "verify",
      },
      20,
      10,
    ),
  ]);
  const provider = new GroundedCodingProvider(inner);
  await assert.rejects(provider.generate(planRequest(discovery())), MissionDomainError);
});

test("non-M4 requests pass through unchanged", async () => {
  const inner = new ScriptedProvider([modelResponse({ ok: true }, 10, 5)]);
  const provider = new GroundedCodingProvider(inner);
  const request: ModelRequest = {
    messages: [{ content: [{ text: "hello", type: "text" }], role: "user" }],
    model: "fixture-model",
  };
  await provider.generate(request);
  assert.deepEqual(inner.requests[0], request);
});

test("grounded provider normalizes model schema violations into a bounded contract failure", async () => {
  const inner = new ScriptedProvider([
    modelResponse({ change: { path: "src/user.ts" }, qualityCommandId: "verify" }, 10, 5),
  ]);
  const provider = new GroundedCodingProvider(inner);
  await assert.rejects(provider.generate(planRequest(discovery())), (error: unknown) => {
    assert.ok(error instanceof MissionDomainError);
    assert.equal(error.message, "Grounded coding plan failed schema validation.");
    return true;
  });
});
