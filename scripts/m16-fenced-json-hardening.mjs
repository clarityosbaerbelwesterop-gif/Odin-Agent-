import { readFileSync, writeFileSync } from "node:fs";

const sourcePath = "src/providers/openai-compatible.ts";
let source = readFileSync(sourcePath, "utf8");
const oldParse = '  return parseJsonValue(provider, text, "Structured output");';
const newParse =
  '  return parseJsonValue(provider, unwrapExactJsonFence(text), "Structured output");';
if (!source.includes(oldParse)) {
  throw new Error("Expected structured-output parser anchor missing.");
}
source = source.replace(oldParse, newParse);

const sourceAnchor = "\nfunction validateExtraHeaders(\n";
const helper = `
function unwrapExactJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = /^\`\`\`(?:json)?[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\`$/u.exec(trimmed);
  return match?.[1]?.trim() ?? text;
}
`;
if (!source.includes(sourceAnchor)) {
  throw new Error("Expected structured-output helper anchor missing.");
}
source = source.replace(sourceAnchor, `${helper}${sourceAnchor}`);
writeFileSync(sourcePath, source);

const testPath = "test/providers/compatible.test.ts";
let tests = readFileSync(testPath, "utf8");
const marker = "compatible strict structured output accepts one exact JSON markdown fence";
if (!tests.includes(marker)) {
  tests += `

test("compatible strict structured output accepts one exact JSON markdown fence", async () => {
  const transport = new MockTransport(() =>
    jsonResponse({
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: { content: "\`\`\`json\\n{\\\"ok\\\":true}\\n\`\`\`", role: "assistant" },
        },
      ],
      id: "chat_fenced",
      model: "test-model",
      usage: { completion_tokens: 8, prompt_tokens: 8, total_tokens: 16 },
    }),
  );
  const provider = new NvidiaProvider({
    capabilities: new CapabilityRegistry([capabilityProfile("nvidia")]),
    credential: () => "nvidia-key",
    transport,
  });
  const response = await provider.generate({
    ...basicRequest(),
    responseFormat: {
      name: "strict_object",
      schema: {
        additionalProperties: false,
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        type: "object",
      },
      strict: true,
      type: "json_schema",
    },
  });
  assert.deepEqual(response.structuredOutput, { ok: true });
});

test("compatible structured output never extracts fenced JSON from surrounding prose", async () => {
  const transport = new MockTransport(() =>
    jsonResponse({
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: { content: "Result:\\n\`\`\`json\\n{\\\"ok\\\":true}\\n\`\`\`", role: "assistant" },
        },
      ],
      id: "chat_prose_fenced",
      model: "test-model",
      usage: { completion_tokens: 9, prompt_tokens: 8, total_tokens: 17 },
    }),
  );
  const provider = new NvidiaProvider({
    capabilities: new CapabilityRegistry([capabilityProfile("nvidia")]),
    credential: () => "nvidia-key",
    transport,
  });
  await assert.rejects(
    provider.generate({
      ...basicRequest(),
      responseFormat: {
        name: "strict_object",
        schema: {
          additionalProperties: false,
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          type: "object",
        },
        strict: true,
        type: "json_schema",
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.category, "malformed_response");
      return true;
    },
  );
});
`;
}
writeFileSync(testPath, tests);
