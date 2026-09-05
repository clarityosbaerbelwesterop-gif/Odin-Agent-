import assert from "node:assert/strict";
import test from "node:test";
import {
  type ProductionIsolationAttestation,
  type ProductionIsolationVerifier,
  type ProductionSandboxAdapter,
  type ProductionSandboxAdapterAllocateRequest,
  type ProductionSandboxAdapterCleanupRequest,
  type ProductionSandboxAdapterExecuteRequest,
  type ProductionSandboxAdapterExecuteResult,
  type ProductionSandboxPolicy,
  type ProductionSecretBroker,
  productionIsolationAttestationHash,
  ProductionSandboxRuntime,
  SandboxError,
} from "../../src/sandbox/index.js";

const NOW = "2026-09-05T08:00:00.000Z";
const FUTURE = "2026-09-05T09:00:00.000Z";
const LATER = "2026-09-05T08:10:00.000Z";
const NETWORK_HASH = "a".repeat(64);

class FixtureProductionAdapter implements ProductionSandboxAdapter {
  allocations = 0;
  cleanups: ProductionSandboxAdapterCleanupRequest[] = [];
  executions: ProductionSandboxAdapterExecuteRequest[] = [];
  result: ProductionSandboxAdapterExecuteResult = {
    outcome: "SUCCEEDED",
    resultRef: "artifact/result-1",
    usage: {
      cpuMillis: 100,
      filesystemWriteBytes: 64,
      memoryBytes: 1_024,
      networkRequests: 1,
      processCount: 1,
      stderrBytes: 0,
      stdoutBytes: 32,
      wallTimeMs: 150,
    },
  };

  async allocate(_request: ProductionSandboxAdapterAllocateRequest) {
    this.allocations += 1;
    return { expiresAt: FUTURE, sessionId: "prod-session-1" };
  }

  async execute(request: ProductionSandboxAdapterExecuteRequest) {
    this.executions.push(request);
    return this.result;
  }

  async cleanup(request: ProductionSandboxAdapterCleanupRequest) {
    this.cleanups.push(request);
  }
}

function policy(overrides: Partial<ProductionSandboxPolicy> = {}): ProductionSandboxPolicy {
  return {
    expiresAt: FUTURE,
    isolation: "container",
    networkResolutionHashes: [NETWORK_HASH],
    policyVersion: "prod-v1",
    quota: {
      cpuMillis: 1_000,
      maxFilesystemWriteBytes: 4_096,
      maxNetworkRequests: 4,
      maxProcesses: 4,
      maxStderrBytes: 4_096,
      maxStdoutBytes: 4_096,
      memoryBytes: 64 * 1024 * 1024,
      wallTimeMs: 5_000,
    },
    secretRefs: ["sandbox/key"],
    workspaceRoots: ["repo"],
    ...overrides,
  };
}

function attestation(
  overrides: Partial<Omit<ProductionIsolationAttestation, "attestationHash">> = {},
): ProductionIsolationAttestation {
  const base = {
    backendId: "prod-container",
    evidenceRefs: ["isolation/evidence-1"],
    expiresAt: FUTURE,
    isolation: "container" as const,
    issuedAt: NOW,
    policyVersion: "prod-v1",
    ...overrides,
  };
  return { ...base, attestationHash: productionIsolationAttestationHash(base) };
}

function runtime(input: {
  adapter?: FixtureProductionAdapter;
  verifier?: ProductionIsolationVerifier;
  broker?: ProductionSecretBroker;
} = {}) {
  const adapter = input.adapter ?? new FixtureProductionAdapter();
  return {
    adapter,
    runtime: new ProductionSandboxRuntime(
      [
        {
          adapter,
          descriptor: {
            id: "prod-container",
            isolation: "container",
            policyVersion: "prod-v1",
          },
        },
      ],
      input.verifier ?? { verify: () => attestation() },
      input.broker ?? { resolve: () => "top-secret-value" },
    ),
  };
}

async function open(runtime: ProductionSandboxRuntime, selectedPolicy = policy()) {
  return runtime.open({
    backendId: "prod-container",
    missionId: "mission-1",
    policy: selectedPolicy,
    requestedAt: NOW,
    signal: new AbortController().signal,
    taskId: "task-1",
  });
}

test("production sandbox binds strong isolation, brokered secrets, audit, and cleanup", async () => {
  const fixture = runtime();
  const session = await open(fixture.runtime);
  const result = await fixture.runtime.execute({
    commandId: "quality.verify",
    idempotencyKey: "exec-1",
    requestedAt: LATER,
    session,
    signal: new AbortController().signal,
  });

  assert.equal(result.outcome, "SUCCEEDED");
  assert.equal(fixture.adapter.allocations, 1);
  assert.equal(fixture.adapter.executions.length, 1);
  assert.deepEqual(fixture.adapter.executions[0]?.secrets, [
    { ref: "sandbox/key", value: "top-secret-value" },
  ]);

  const auditJson = JSON.stringify(fixture.runtime.auditRecords());
  assert.doesNotMatch(auditJson, /top-secret-value/u);
  assert.doesNotMatch(auditJson, /sandbox\/key/u);
  assert.equal(fixture.runtime.auditRecords().map((record) => record.action).join(","), "allocate,execute");

  assert.equal(
    await fixture.runtime.cleanup({
      reason: "completed",
      requestedAt: LATER,
      session,
      signal: new AbortController().signal,
    }),
    "RELEASED",
  );
  assert.equal(
    await fixture.runtime.cleanup({
      reason: "completed",
      requestedAt: LATER,
      session,
      signal: new AbortController().signal,
    }),
    "REPLAYED",
  );
  assert.equal(fixture.adapter.cleanups.length, 1);

  await assert.rejects(
    fixture.runtime.execute({
      commandId: "quality.verify",
      idempotencyKey: "exec-after-release",
      requestedAt: LATER,
      session,
      signal: new AbortController().signal,
    }),
    (error: unknown) => error instanceof SandboxError && error.code === "SESSION_INVALID",
  );
});

test("production sandbox rejects isolation or policy relabeling", async () => {
  const fixture = runtime();
  await assert.rejects(
    open(fixture.runtime, policy({ isolation: "vm" })),
    (error: unknown) =>
      error instanceof SandboxError &&
      error.code === "POLICY_INVALID" &&
      error.message.includes("relabel"),
  );
});

test("production sandbox rejects tampered isolation attestation", async () => {
  const fixture = runtime({
    verifier: {
      verify: () => ({ ...attestation(), attestationHash: "b".repeat(64) }),
    },
  });
  await assert.rejects(
    open(fixture.runtime),
    (error: unknown) => error instanceof SandboxError && error.code === "ATTESTATION_INVALID",
  );
  assert.equal(fixture.adapter.allocations, 0);
});

test("production sandbox rejects changed replay policy", async () => {
  const fixture = runtime();
  await open(fixture.runtime);
  await assert.rejects(
    open(
      fixture.runtime,
      policy({
        quota: { ...policy().quota, cpuMillis: 999 },
      }),
    ),
    (error: unknown) => error instanceof SandboxError && error.code === "SESSION_INVALID",
  );
  assert.equal(fixture.adapter.allocations, 1);
});

test("production sandbox detects quota escape, cleans up, and fences reuse", async () => {
  const adapter = new FixtureProductionAdapter();
  adapter.result = {
    outcome: "SUCCEEDED",
    usage: {
      cpuMillis: 5_000,
      filesystemWriteBytes: 0,
      memoryBytes: 1_024,
      networkRequests: 0,
      processCount: 1,
      stderrBytes: 0,
      stdoutBytes: 0,
      wallTimeMs: 10,
    },
  };
  const fixture = runtime({ adapter });
  const session = await open(fixture.runtime);

  await assert.rejects(
    fixture.runtime.execute({
      commandId: "quality.verify",
      idempotencyKey: "exec-quota",
      requestedAt: LATER,
      session,
      signal: new AbortController().signal,
    }),
    (error: unknown) => error instanceof SandboxError && error.code === "QUOTA_EXCEEDED",
  );
  assert.equal(adapter.cleanups.length, 1);
  assert.equal(adapter.cleanups[0]?.reason, "quota_exceeded");

  await assert.rejects(
    fixture.runtime.execute({
      commandId: "quality.verify",
      idempotencyKey: "exec-quota-reuse",
      requestedAt: LATER,
      session,
      signal: new AbortController().signal,
    }),
    (error: unknown) => error instanceof SandboxError && error.code === "SESSION_INVALID",
  );
});

test("production sandbox rejects tampered sessions and scoped secret denial", async () => {
  const fixture = runtime({
    broker: {
      resolve: (request) => {
        if (request.missionId !== "mission-1" || request.taskId !== "task-1") {
          throw new Error("scope denied");
        }
        return "top-secret-value";
      },
    },
  });
  const session = await open(fixture.runtime);
  await assert.rejects(
    fixture.runtime.execute({
      commandId: "quality.verify",
      idempotencyKey: "exec-tamper",
      requestedAt: LATER,
      session: { ...session, missionId: "mission-2" },
      signal: new AbortController().signal,
    }),
    (error: unknown) => error instanceof SandboxError && error.code === "SESSION_INVALID",
  );
});

test("production sandbox rejects future isolation evidence", async () => {
  const futureEvidence = attestation({ issuedAt: "2026-09-05T08:30:00.000Z" });
  const fixture = runtime({ verifier: { verify: () => futureEvidence } });
  await assert.rejects(
    open(fixture.runtime),
    (error: unknown) => error instanceof SandboxError && error.code === "ATTESTATION_INVALID",
  );
});
