import assert from "node:assert/strict";
import test from "node:test";
import { selectBotModel } from "../../src/bot/executor.js";
import type { ChatModel, ProductPlan } from "../../src/chat/types.js";

function model(id: string, plan: ProductPlan): ChatModel {
  return { id, plan } as ChatModel;
}

const catalog: readonly ChatModel[] = [
  model("gpt-oss-20b", "free"),
  model("gpt-oss-120b", "pro"),
  model("deepseek-v4-flash", "developer"),
  model("kimi", "developer"),
  model("deepseek-v4-pro", "ultra"),
  model("openrouter-gpt-5-6-luna", "pro"),
  model("openrouter-claude-fable-5-1", "developer"),
  model("openrouter-claude-opus-5", "ultra"),
];

test("Pro bot defaults to the OpenRouter frontier lane for reasoning", () => {
  assert.equal(selectBotModel(catalog, "pro", "thinking")?.id, "openrouter-gpt-5-6-luna");
  assert.equal(selectBotModel(catalog, "pro", "research")?.id, "openrouter-gpt-5-6-luna");
});

test("Developer coding prefers Fable while Ultra coding prefers Opus", () => {
  assert.equal(selectBotModel(catalog, "developer", "coding")?.id, "openrouter-claude-fable-5-1");
  assert.equal(selectBotModel(catalog, "ultra", "coding")?.id, "openrouter-claude-opus-5");
});

test("explicit model choice wins only when the subscription is entitled", () => {
  assert.equal(selectBotModel(catalog, "developer", "coding", "kimi")?.id, "kimi");
  assert.equal(
    selectBotModel(catalog, "developer", "coding", "openrouter-claude-opus-5"),
    undefined,
  );
});

test("router falls back cleanly when OpenRouter capacity is absent", () => {
  const nvidiaOnly = catalog.filter((entry) => !entry.id.startsWith("openrouter-"));
  assert.equal(selectBotModel(nvidiaOnly, "developer", "coding")?.id, "kimi");
  assert.equal(selectBotModel(nvidiaOnly, "pro", "thinking")?.id, "gpt-oss-120b");
});
