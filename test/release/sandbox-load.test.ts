import assert from "node:assert/strict";
import test from "node:test";
import {
  type SandboxBackendAdapter,
  type SandboxBackendCreateRequest,
  type SandboxBackendDestroyRequest,
  SandboxBackendRegistry,
} from "../../src/sandbox/index.js";

class LoadBackend implements SandboxBackendAdapter {
  createCalls = 0;
  destroyCalls = 0;
  readonly #destroyGate: Promise<void>;
  #resolveDestroy: (() => void) | undefined;

  constructor() {
    this.#destroyGate = new Promise<void>((resolve) => {
      this.#resolveDestroy = resolve;
    });
  }

  async create(_request: SandboxBackendCreateRequest) {
    this.createCalls += 1;
    await Promise.resolve();
    return { sessionId: "load-session" };
  }

  async destroy(_request: SandboxBackendDestroyRequest): Promise<void> {
    this.destroyCalls += 1;
    await this.#destroyGate;
  }

  releaseDestroy(): void {
    this.#resolveDestroy?.();
  }
}

function registry(backend: LoadBackend): SandboxBackendRegistry {
  return new SandboxBackendRegistry(
    [
      {
        adapter: backend,
        descriptor: {
          id: "load-remote",
          isolation: "provider_managed",
          kind: "remote_api",
          label: "Load remote sandbox",
          requiresCredential: true,
        },
      },
    ],
    [
      {
        backendId: "load-remote",
        credentialRef: "sandbox/load",
        model: "gpt-load",
        profileVersion: "profile-v1",
        provider: "openai",
      },
    ],
    () => "sandbox-secret",
  );
}

function allocation() {
  return {
    missionId: "mission-load",
    model: "gpt-load",
    profileVersion: "profile-v1",
    provider: "openai",
    signal: new AbortController().signal,
    taskId: "task-load",
    timeoutMs: 60_000,
  } as const;
}

test("32 concurrent identical sandbox allocations create once and concurrent release destroys once", async () => {
  const backend = new LoadBackend();
  const sandbox = registry(backend);

  const sessions = await Promise.all(
    Array.from({ length: 32 }, () => sandbox.allocate(allocation())),
  );
  assert.equal(backend.createCalls, 1);
  assert.equal(new Set(sessions.map((session) => session.selectionHash)).size, 1);

  const releases = sessions.slice(0, 16).map((session) =>
    sandbox.release({
      reason: "completed",
      session,
      signal: new AbortController().signal,
    }),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const destroyCallsBeforeCompletion = backend.destroyCalls;
  backend.releaseDestroy();
  const outcomes = await Promise.all(releases);

  assert.equal(destroyCallsBeforeCompletion, 1);
  assert.equal(backend.destroyCalls, 1);
  assert.equal(outcomes.filter((outcome) => outcome === "RELEASED").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome === "REPLAYED").length, 15);
});
