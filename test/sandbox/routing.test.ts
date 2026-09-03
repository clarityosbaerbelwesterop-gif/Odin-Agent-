import assert from "node:assert/strict";
import test from "node:test";
import type { RoutingCandidate, RoutingDecision } from "../../src/routing/index.js";
import {
  type SandboxBackendAdapter,
  type SandboxBackendCreateRequest,
  SandboxBackendRegistry,
  SandboxError,
  RoutedSandboxAllocator,
} from "../../src/sandbox/index.js";

class RoutedBackend implements SandboxBackendAdapter {
  readonly requests: SandboxBackendCreateRequest[] = [];
  readonly #sessionId: string;

  constructor(sessionId: string) {
    this.#sessionId = sessionId;
  }

  async create(request: SandboxBackendCreateRequest) {
    this.requests.push(request);
    return { sessionId: this.#sessionId };
  }
}

function candidate(
  provider: string,
  model: string,
  profileVersion: string,
  id: string,
): RoutingCandidate {
  return {
    estimatedCostMicros: 10,
    evaluationHash: `${id}-hash`,
    evaluationId: id,
    medianLatencyMs: 100,
    model,
    passRateBps: 9_000,
    profileVersion,
    provider,
    qualityScoreBps: 9_000,
    reasoningEffort: null,
  };
}

function decision(): RoutingDecision {
  return {
    cache: { maxAgeMs: 0, readAllowed: false, writeAllowed: false },
    decisionHash: "route-decision-hash",
    effectiveQualityFloorBps: 8_000,
    escalations: [candidate("anthropic", "claude-test", "profile-a", "eval-anthropic")],
    missionId: "mission-routed",
    primary: candidate("openai", "gpt-test", "profile-o", "eval-openai"),
    reasoning: {
      branchCount: 1,
      branches: [{ id: "branch-direct", kind: "direct" }],
      critiquePasses: 0,
      estimatedTokensPerCall: 1_000,
      maxEstimatedTokens: 2_000,
      maxModelCalls: 2,
      parallelism: 1,
      planHash: "plan-hash",
      repairAttempts: 1,
    },
    reasons: ["fixture"],
    taskClass: "coding",
    taskId: "task-routed",
  };
}

function routedRegistry(openai: RoutedBackend, anthropic: RoutedBackend) {
  return new SandboxBackendRegistry(
    [
      {
        adapter: openai,
        descriptor: {
          id: "sandbox-openai",
          isolation: "provider_managed",
          kind: "remote_api",
          label: "OpenAI route sandbox",
          requiresCredential: true,
        },
      },
      {
        adapter: anthropic,
        descriptor: {
          id: "sandbox-anthropic",
          isolation: "provider_managed",
          kind: "remote_api",
          label: "Anthropic route sandbox",
          requiresCredential: true,
        },
      },
    ],
    [
      {
        backendId: "sandbox-openai",
        credentialRef: "sandbox-key-openai",
        model: "gpt-test",
        profileVersion: "profile-o",
        provider: "openai",
      },
      {
        backendId: "sandbox-anthropic",
        credentialRef: "sandbox-key-anthropic",
        model: "claude-test",
        profileVersion: "profile-a",
        provider: "anthropic",
      },
    ],
    (reference) => (reference === "sandbox-key-openai" ? "secret-o" : "secret-a"),
  );
}

test("primary M11 route automatically selects the exact model-bound sandbox", async () => {
  const openai = new RoutedBackend("session-o");
  const anthropic = new RoutedBackend("session-a");
  const allocator = new RoutedSandboxAllocator(routedRegistry(openai, anthropic));

  const session = await allocator.allocate({
    choice: { kind: "primary" },
    decision: decision(),
    signal: new AbortController().signal,
    timeoutMs: 60_000,
  });

  assert.equal(session.backendId, "sandbox-openai");
  assert.equal(session.routeDecisionHash, "route-decision-hash");
  assert.equal(session.routeEvaluationId, "eval-openai");
  assert.equal(session.routeEvaluationHash, "eval-openai-hash");
  assert.deepEqual(session.routeChoice, { kind: "primary" });
  assert.equal(openai.requests[0]?.credential, "secret-o");
  assert.equal(openai.requests[0]?.missionId, "mission-routed");
  assert.equal(openai.requests[0]?.taskId, "task-routed");
  assert.equal(anthropic.requests.length, 0);
});

test("runtime-owned M11 escalation index switches to the escalation model sandbox", async () => {
  const openai = new RoutedBackend("session-o");
  const anthropic = new RoutedBackend("session-a");
  const allocator = new RoutedSandboxAllocator(routedRegistry(openai, anthropic));

  const session = await allocator.allocate({
    choice: { index: 0, kind: "escalation" },
    decision: decision(),
    signal: new AbortController().signal,
    timeoutMs: 60_000,
  });

  assert.equal(session.backendId, "sandbox-anthropic");
  assert.equal(session.routeEvaluationId, "eval-anthropic");
  assert.deepEqual(session.routeChoice, { index: 0, kind: "escalation" });
  assert.equal(anthropic.requests[0]?.credential, "secret-a");
  assert.equal(anthropic.requests[0]?.model, "claude-test");
  assert.equal(openai.requests.length, 0);
});

test("invalid escalation choices fail before any sandbox backend or credential path is used", async () => {
  const openai = new RoutedBackend("session-o");
  const anthropic = new RoutedBackend("session-a");
  let credentialCalls = 0;
  const registry = new SandboxBackendRegistry(
    [
      {
        adapter: openai,
        descriptor: {
          id: "sandbox-openai",
          isolation: "provider_managed",
          kind: "remote_api",
          label: "OpenAI route sandbox",
          requiresCredential: true,
        },
      },
    ],
    [
      {
        backendId: "sandbox-openai",
        credentialRef: "sandbox-key-openai",
        model: "gpt-test",
        profileVersion: "profile-o",
        provider: "openai",
      },
    ],
    () => {
      credentialCalls += 1;
      return "secret";
    },
  );
  const allocator = new RoutedSandboxAllocator(registry);

  await assert.rejects(
    allocator.allocate({
      choice: { index: 3, kind: "escalation" },
      decision: decision(),
      signal: new AbortController().signal,
      timeoutMs: 60_000,
    }),
    (error: unknown) => error instanceof SandboxError && error.code === "BACKEND_INVALID",
  );
  assert.equal(credentialCalls, 0);
  assert.equal(openai.requests.length, 0);
  assert.equal(anthropic.requests.length, 0);
});
