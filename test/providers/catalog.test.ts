import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILTIN_MODEL_CATALOG,
  builtinCapabilityRegistry,
  CapabilityRegistry,
  GoogleProvider,
} from "../../src/providers/index.js";
import { capabilityProfile } from "./helpers.js";

test("the builtin catalog ships three OpenAI and three Gemini models", () => {
  assert.equal(BUILTIN_MODEL_CATALOG.length, 6);
  assert.deepEqual(
    BUILTIN_MODEL_CATALOG.map(({ provider, model }) => `${provider}/${model}`).sort(),
    [
      "google/gemini-3.1-flash-lite",
      "google/gemini-3.1-pro-preview",
      "google/gemini-3.7-flash",
      "openai/gpt-5.6-luna",
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra",
    ],
  );
});

test("builtin profiles are valid, resolvable, and carry routing metadata", () => {
  const registry = builtinCapabilityRegistry();
  for (const profile of BUILTIN_MODEL_CATALOG) {
    const resolved = registry.resolve(profile.provider, profile.model);
    assert.equal(resolved.capabilities.toolUse, true);
    assert.equal(resolved.capabilities.streaming, true);
    assert.ok(resolved.capabilities.reasoningEfforts.length > 0);
    assert.ok((resolved.capabilities.contextWindowTokens ?? 0) > 0);
    assert.equal(resolved.pricing?.currency, "USD");
    assert.ok(resolved.routing !== undefined);
    assert.equal(resolved.provenance.kind, "provider");
  }
  assert.equal(registry.list("openai").length, 3);
  assert.equal(registry.list("google").length, 3);
});

test("the builtin catalog survives configuration round-trips and accepts overrides", () => {
  const roundTripped = CapabilityRegistry.fromConfig(
    JSON.parse(JSON.stringify(BUILTIN_MODEL_CATALOG)),
  );
  assert.equal(roundTripped.list().length, 6);

  const overridden = builtinCapabilityRegistry([
    capabilityProfile("openai", "gpt-5.6-sol", { imageInput: false }),
  ]);
  assert.equal(overridden.list().length, 6);
  assert.equal(overridden.resolve("openai", "gpt-5.6-sol").capabilities.imageInput, false);
});

test("the Gemini provider is registered under the google provider id", () => {
  const provider = new GoogleProvider({
    capabilities: builtinCapabilityRegistry(),
    credential: () => "key",
  });
  assert.equal(provider.id, "google");
});
