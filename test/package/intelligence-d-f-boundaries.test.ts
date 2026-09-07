import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCES = [
  "src/routing/amplification.ts",
  "src/routing/scaffolding.ts",
  "src/routing/frontier-amplification.ts",
] as const;

function source(path: (typeof SOURCES)[number]): string {
  return readFileSync(path, "utf8");
}

test("D-F intelligence policy remains provider-neutral and cannot execute tools or external effects", () => {
  for (const path of SOURCES) {
    const text = source(path);
    assert.doesNotMatch(text, /from ["'][^"']*providers\//u, path);
    assert.doesNotMatch(text, /from ["'][^"']*tools\//u, path);
    assert.doesNotMatch(text, /from ["'][^"']*sandbox\//u, path);
    assert.doesNotMatch(text, /from ["'][^"']*release\//u, path);
    assert.doesNotMatch(text, /process\.env/u, path);
    assert.doesNotMatch(text, /child_process/u, path);
    assert.doesNotMatch(text, /\bfetch\s*\(/u, path);
    assert.doesNotMatch(text, /\b(?:gpt|gemini|kimi|claude)[-_0-9]/iu, path);
  }
});

test("Phase F is structurally analytics-only and reuses Benchmark 2.0 evaluation authority", () => {
  const text = source("src/routing/frontier-amplification.ts");
  assert.match(text, /authority: "evaluation_only"/u);
  assert.match(text, /authority: "analytics_only"/u);
  assert.match(text, /routingEligible: false/u);
  assert.match(text, /promotionEligible: false/u);
  assert.match(text, /evaluateBenchmarkV2\(/u);
});

test("Phase E classification does not branch on provider or model names", () => {
  const text = source("src/routing/scaffolding.ts");
  assert.doesNotMatch(text, /model\.(?:includes|startsWith|endsWith|match|toLowerCase)/u);
  assert.doesNotMatch(text, /provider\.(?:includes|startsWith|endsWith|match|toLowerCase)/u);
  assert.match(text, /qualityScoreBps/u);
  assert.match(text, /contextWindowTokens/u);
  assert.match(text, /maxOutputTokens/u);
});
