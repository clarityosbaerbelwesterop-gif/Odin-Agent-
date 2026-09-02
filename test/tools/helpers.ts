import type { JsonObject } from "../../src/providers/types.js";
import type {
  CapabilityGrant,
  ToolManifest,
  ToolRegistration,
} from "../../src/tools/types.js";

export const NOW = "2026-09-02T12:00:00.000Z";

export function baseManifest(overrides: Partial<ToolManifest> = {}): ToolManifest {
  return {
    description: "Read a named resource for tests.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        path: { maxLength: 100, minLength: 1, type: "string" },
      },
      required: ["path"],
      type: "object",
    },
    name: "test.read",
    operation: "read",
    provenance: {
      kind: "project",
      observedAt: NOW,
      reference: "test fixture",
    },
    retryPolicy: {
      maxAttempts: 1,
      retryableCategories: [],
      timeoutMs: 100,
    },
    riskClass: "low",
    sideEffecting: false,
    summary: "Read test resource",
    trustClass: "project",
    version: "1",
    ...overrides,
  };
}

export function registration(
  overrides: Partial<ToolRegistration> = {},
  manifestOverrides: Partial<ToolManifest> = {},
): ToolRegistration {
  return {
    handler: (input) => ({ path: input.path ?? null }),
    manifest: baseManifest(manifestOverrides),
    resourceFromInput: (input) => String(input.path ?? ""),
    ...overrides,
  };
}

export function grant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    expiresAt: "2026-09-02T13:00:00.000Z",
    grantId: "grant-1",
    maxCalls: 5,
    missionId: "mission-1",
    operation: "read",
    resourcePrefix: "src",
    taskId: "task-1",
    tool: "test.read",
    ...overrides,
  };
}

export function input(path = "src/index.ts"): JsonObject {
  return { path };
}
