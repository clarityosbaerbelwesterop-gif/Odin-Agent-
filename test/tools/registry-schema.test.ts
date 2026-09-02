import assert from "node:assert/strict";
import test from "node:test";
import { ToolRegistry } from "../../src/tools/registry.js";
import { validateToolInput } from "../../src/tools/schema.js";
import { ToolRuntimeError } from "../../src/tools/types.js";
import { registration } from "./helpers.js";

test("registry exposes compact summaries and resolves full manifests explicitly", () => {
  const registry = new ToolRegistry([registration()]);
  const summaries = registry.listSummaries();
  assert.equal(summaries.length, 1);
  assert.equal("inputSchema" in (summaries[0] ?? {}), false);
  assert.equal(registry.resolveManifest("test.read", "1").inputSchema.type, "object");
});

test("registry rejects duplicate tools and unsafe retry semantics", () => {
  const registry = new ToolRegistry([registration()]);
  assert.throws(
    () => registry.register(registration()),
    (error: unknown) => {
      assert.ok(error instanceof ToolRuntimeError);
      assert.equal(error.category, "conflict");
      return true;
    },
  );

  assert.throws(
    () =>
      new ToolRegistry([
        registration(
          {},
          {
            sideEffecting: true,
            retryPolicy: {
              maxAttempts: 2,
              retryableCategories: ["timeout"],
              timeoutMs: 100,
            },
          },
        ),
      ]),
    /single-attempt/,
  );
});

test("unsupported schema keywords fail closed during registration", () => {
  const unsafe = registration(
    {},
    {
      inputSchema: {
        additionalProperties: false,
        properties: {
          path: { minLength: 1, pattern: "^src/", type: "string" },
        },
        required: ["path"],
        type: "object",
      },
    },
  );
  assert.throws(
    () => new ToolRegistry([unsafe]),
    (error: unknown) => {
      assert.ok(error instanceof ToolRuntimeError);
      assert.equal(error.category, "invalid_input");
      assert.match(error.message, /unsupported schema keyword/);
      return true;
    },
  );
});

test("strict input validation rejects missing, unknown, type, and bound violations", () => {
  const schema = registration().manifest.inputSchema;
  assert.throws(() => validateToolInput(schema, {}), /required property is missing/);
  assert.throws(
    () => validateToolInput(schema, { extra: true, path: "src/a.ts" }),
    /unknown property/,
  );
  assert.throws(() => validateToolInput(schema, { path: 42 }), /expected string/);
  assert.throws(() => validateToolInput(schema, { path: "" }), /string is too short/);
});
