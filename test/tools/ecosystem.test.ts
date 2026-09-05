import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryCapabilityPolicy,
  InMemoryToolAuditSink,
  ToolEcosystem,
  ToolEcosystemError,
  ToolRegistry,
  ToolRuntime,
  ToolRuntimeError,
  type ToolEcosystemCategory,
  type ToolManifest,
  type ToolRegistration,
} from "../../src/tools/index.js";

const NOW = "2026-09-05T08:00:00.000Z";
const EXPIRES = "2026-09-05T09:00:00.000Z";
const CATEGORIES: readonly ToolEcosystemCategory[] = [
  "repository",
  "browser",
  "database",
  "cloud",
  "documents",
  "data",
  "cicd",
  "api",
  "research",
];

function manifest(name: string, overrides: Partial<ToolManifest> = {}): ToolManifest {
  return {
    description: `Fixture adapter ${name}`,
    inputSchema: {
      additionalProperties: false,
      properties: { path: { minLength: 1, type: "string" } },
      required: ["path"],
      type: "object",
    },
    name,
    operation: "read",
    provenance: { kind: "project", observedAt: NOW, reference: "test:m25" },
    retryPolicy: { maxAttempts: 1, retryableCategories: [], timeoutMs: 100 },
    riskClass: "low",
    sideEffecting: false,
    summary: `Fixture ${name}`,
    trustClass: "project",
    version: "1",
    ...overrides,
  };
}

function registration(toolManifest: ToolManifest): ToolRegistration {
  return {
    handler: (input) => ({ path: input.path ?? null, tool: toolManifest.name }),
    manifest: toolManifest,
    resourceFromInput: (input) => String(input.path ?? ""),
  };
}

function descriptor(category: ToolEcosystemCategory, toolManifest: ToolManifest) {
  return {
    adapterId: `adapter.${category}`,
    category,
    confirmation: toolManifest.riskClass === "high" ? ("m3-policy" as const) : ("none" as const),
    costClass: category === "cloud" || category === "api" ? ("metered" as const) : ("none" as const),
    credentialMode:
      category === "browser" || category === "cloud" || category === "database" || category === "api"
        ? ("brokered" as const)
        : ("none" as const),
    maxAttempts: toolManifest.retryPolicy.maxAttempts,
    networkAccess:
      category === "browser" || category === "cloud" || category === "database" || category === "api",
    operation: toolManifest.operation,
    riskClass: toolManifest.riskClass,
    sideEffecting: toolManifest.sideEffecting,
    timeoutMs: toolManifest.retryPolicy.timeoutMs,
    tool: toolManifest.name,
    trustClass: toolManifest.trustClass,
    version: toolManifest.version,
  };
}

test("M25 catalogs all nine adapter categories from exact registered M3 manifests", () => {
  const registrations = CATEGORIES.map((category) => registration(manifest(`fixture.${category}`)));
  const registry = new ToolRegistry(registrations);
  const runtime = new ToolRuntime(
    registry,
    new InMemoryCapabilityPolicy(),
    new InMemoryToolAuditSink(),
    () => NOW,
  );
  const ecosystem = new ToolEcosystem(registry, runtime);
  for (const category of [...CATEGORIES].reverse()) {
    const toolManifest = registry.resolveManifest(`fixture.${category}`, "1");
    ecosystem.register(descriptor(category, toolManifest));
  }

  const summaries = ecosystem.discover();
  assert.equal(summaries.length, 9);
  assert.deepEqual(
    summaries.map((item) => item.adapterId),
    [...summaries.map((item) => item.adapterId)].sort(),
  );
  assert.equal(JSON.stringify(summaries).includes("inputSchema"), false);
  assert.equal(JSON.stringify(summaries).includes("description"), false);
  assert.equal(ecosystem.discover("repository").length, 1);
  assert.equal(ecosystem.resolveManifest("adapter.repository").inputSchema.type, "object");
});

test("M25 execution delegates to M3 policy and cannot turn network or credential metadata into authority", async () => {
  const browserManifest = manifest("fixture.browser");
  const registry = new ToolRegistry([registration(browserManifest)]);
  const runtime = new ToolRuntime(
    registry,
    new InMemoryCapabilityPolicy(),
    new InMemoryToolAuditSink(),
    () => NOW,
  );
  const ecosystem = new ToolEcosystem(registry, runtime);
  ecosystem.register(descriptor("browser", browserManifest));

  await assert.rejects(
    () =>
      ecosystem.execute("adapter.browser", {
        input: { path: "https://example.invalid" },
        missionId: "mission-1",
        taskId: "task-1",
      }),
    (error: unknown) => error instanceof ToolRuntimeError && error.category === "denied",
  );
});

test("M25 high-risk side effects still require idempotency, scoped M3 grant, approval, and audit", async () => {
  let calls = 0;
  const writeManifest = manifest("fixture.cloud-write", {
    operation: "write",
    riskClass: "high",
    sideEffecting: true,
    summary: "High-risk cloud write fixture",
  });
  const registry = new ToolRegistry([
    {
      ...registration(writeManifest),
      handler: () => {
        calls += 1;
        return { calls };
      },
    },
  ]);
  const policy = new InMemoryCapabilityPolicy([
    {
      expiresAt: EXPIRES,
      grantId: "grant-cloud-write",
      maxCalls: 1,
      missionId: "mission-1",
      operation: "write",
      resourcePrefix: "src",
      taskId: "task-1",
      tool: "fixture.cloud-write",
    },
  ]);
  const audit = new InMemoryToolAuditSink();
  const runtime = new ToolRuntime(registry, policy, audit, () => NOW);
  const ecosystem = new ToolEcosystem(registry, runtime);
  ecosystem.register({
    ...descriptor("cloud", writeManifest),
    adapterId: "adapter.cloud-write",
    costClass: "metered",
    credentialMode: "brokered",
    networkAccess: true,
  });

  await assert.rejects(
    () =>
      ecosystem.execute("adapter.cloud-write", {
        input: { path: "src/config.json" },
        missionId: "mission-1",
        taskId: "task-1",
      }),
    (error: unknown) => error instanceof ToolEcosystemError && error.code === "DENIED",
  );

  const baseRequest = {
    idempotencyKey: "cloud-write-1",
    input: { path: "src/config.json" },
    missionId: "mission-1",
    taskId: "task-1",
  } as const;
  await assert.rejects(
    () => ecosystem.execute("adapter.cloud-write", baseRequest),
    (error: unknown) => error instanceof ToolRuntimeError && error.category === "require_approval",
  );

  const approval = {
    approvalId: "approval-cloud-write",
    expiresAt: EXPIRES,
    missionId: "mission-1",
    taskId: "task-1",
    tool: "fixture.cloud-write",
  } as const;
  const first = await ecosystem.execute("adapter.cloud-write", { ...baseRequest, approval });
  const replay = await ecosystem.execute("adapter.cloud-write", { ...baseRequest, approval });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(calls, 1);
  assert.equal(policy.callsUsed("grant-cloud-write"), 1);
  assert.deepEqual(audit.records().map((record) => record.policyDecision), [
    "REQUIRE_APPROVAL",
    "ALLOW",
    "REPLAY",
  ]);
});

test("M25 rejects descriptor tampering, unknown tools, and weakened confirmation metadata", () => {
  const readManifest = manifest("fixture.repository");
  const highManifest = manifest("fixture.high", { riskClass: "high" });
  const registry = new ToolRegistry([registration(readManifest), registration(highManifest)]);
  const runtime = new ToolRuntime(
    registry,
    new InMemoryCapabilityPolicy(),
    new InMemoryToolAuditSink(),
    () => NOW,
  );
  const ecosystem = new ToolEcosystem(registry, runtime);

  assert.throws(
    () => ecosystem.register({ ...descriptor("repository", readManifest), operation: "write" }),
    (error: unknown) => error instanceof ToolEcosystemError && error.code === "CONFLICT",
  );
  assert.throws(
    () => ecosystem.register({ ...descriptor("research", highManifest), confirmation: "none" }),
    (error: unknown) => error instanceof ToolEcosystemError && error.code === "DENIED",
  );
  assert.throws(
    () => ecosystem.register({ ...descriptor("research", readManifest), adapterId: "adapter.unknown", tool: "missing.tool" }),
    (error: unknown) => error instanceof ToolEcosystemError && error.code === "NOT_FOUND",
  );
});

test("M25 exact descriptor identity is immutable and duplicate conflicting registration fails closed", () => {
  const readManifest = manifest("fixture.data");
  const registry = new ToolRegistry([registration(readManifest)]);
  const runtime = new ToolRuntime(
    registry,
    new InMemoryCapabilityPolicy(),
    new InMemoryToolAuditSink(),
    () => NOW,
  );
  const ecosystem = new ToolEcosystem(registry, runtime);
  const exact = descriptor("data", readManifest);
  ecosystem.register(exact);
  assert.deepEqual(ecosystem.register(exact), ecosystem.discover("data")[0]);
  assert.throws(
    () => ecosystem.register({ ...exact, costClass: "metered" }),
    (error: unknown) => error instanceof ToolEcosystemError && error.code === "CONFLICT",
  );
});
