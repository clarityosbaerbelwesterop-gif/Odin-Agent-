import assert from "node:assert/strict";
import test from "node:test";
import {
  type SandboxBackendAdapter,
  type SandboxBackendCreateRequest,
  type SandboxBackendDestroyRequest,
  SandboxBackendRegistry,
  SandboxError,
} from "../../src/sandbox/index.js";

class BlockingDestroyBackend implements SandboxBackendAdapter {
  readonly #gate: Promise<void>;
  #resolve: (() => void) | undefined;

  constructor() {
    this.#gate = new Promise<void>((resolve) => {
      this.#resolve = resolve;
    });
  }

  async create(_request: SandboxBackendCreateRequest) {
    return { sessionId: "conflict-session" };
  }

  async destroy(_request: SandboxBackendDestroyRequest): Promise<void> {
    await this.#gate;
  }

  finish(): void {
    this.#resolve?.();
  }
}

test("concurrent release replay with a different reason fails closed", async () => {
  const backend = new BlockingDestroyBackend();
  const registry = new SandboxBackendRegistry(
    [
      {
        adapter: backend,
        descriptor: {
          id: "conflict-remote",
          isolation: "provider_managed",
          kind: "remote_api",
          label: "Conflict remote sandbox",
          requiresCredential: true,
        },
      },
    ],
    [
      {
        backendId: "conflict-remote",
        credentialRef: "sandbox/conflict",
        model: "gpt-conflict",
        profileVersion: "v1",
        provider: "openai",
      },
    ],
    () => "sandbox-secret",
  );
  const session = await registry.allocate({
    missionId: "mission-conflict",
    model: "gpt-conflict",
    profileVersion: "v1",
    provider: "openai",
    signal: new AbortController().signal,
    taskId: "task-conflict",
    timeoutMs: 60_000,
  });

  const first = registry.release({
    reason: "completed",
    session,
    signal: new AbortController().signal,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(
    registry.release({
      reason: "failed",
      session,
      signal: new AbortController().signal,
    }),
    (error: unknown) => error instanceof SandboxError && error.code === "SESSION_INVALID",
  );

  backend.finish();
  assert.equal(await first, "RELEASED");
  await assert.rejects(
    registry.release({
      reason: "failed",
      session,
      signal: new AbortController().signal,
    }),
    (error: unknown) => error instanceof SandboxError && error.code === "SESSION_INVALID",
  );
  assert.equal(
    await registry.release({
      reason: "completed",
      session,
      signal: new AbortController().signal,
    }),
    "REPLAYED",
  );
});
