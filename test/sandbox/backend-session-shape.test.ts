import assert from "node:assert/strict";
import test from "node:test";
import {
  type SandboxBackendAdapter,
  type SandboxBackendCreateRequest,
  type SandboxBackendDestroyRequest,
  SandboxBackendRegistry,
} from "../../src/sandbox/index.js";

class ExpiryOptionalBackend implements SandboxBackendAdapter {
  readonly destroys: SandboxBackendDestroyRequest[] = [];

  async create(_request: SandboxBackendCreateRequest) {
    return { sessionId: "no-expiry-session" };
  }

  async destroy(request: SandboxBackendDestroyRequest): Promise<void> {
    this.destroys.push(request);
  }
}

test("sessions without provider expiry omit expiresAt and still release deterministically", async () => {
  const backend = new ExpiryOptionalBackend();
  const registry = new SandboxBackendRegistry(
    [
      {
        adapter: backend,
        descriptor: {
          id: "remote-no-expiry",
          isolation: "provider_managed",
          kind: "remote_api",
          label: "Remote sandbox without expiry",
          requiresCredential: true,
        },
      },
    ],
    [
      {
        backendId: "remote-no-expiry",
        credentialRef: "sandbox/no-expiry",
        model: "gpt-test",
        profileVersion: "profile-v1",
        provider: "openai",
      },
    ],
    () => "sandbox-secret",
  );

  const session = await registry.allocate({
    missionId: "mission-no-expiry",
    model: "gpt-test",
    profileVersion: "profile-v1",
    provider: "openai",
    signal: new AbortController().signal,
    taskId: "task-no-expiry",
    timeoutMs: 60_000,
  });

  assert.equal(Object.hasOwn(session, "expiresAt"), false);
  assert.equal(
    await registry.release({
      reason: "completed",
      session,
      signal: new AbortController().signal,
    }),
    "RELEASED",
  );
  assert.equal(backend.destroys.length, 1);
});
