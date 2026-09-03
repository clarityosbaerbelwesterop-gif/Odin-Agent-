import assert from "node:assert/strict";
import test from "node:test";
import {
  type SandboxBackendAdapter,
  type SandboxBackendCreateRequest,
  SandboxBackendRegistry,
  SandboxError,
} from "../../src/sandbox/index.js";

class CreateOnlyRemoteBackend implements SandboxBackendAdapter {
  async create(_request: SandboxBackendCreateRequest) {
    return { sessionId: "create-only-session" };
  }
}

test("remote sandbox backends without deterministic destroy fail closed at registration", () => {
  const backend = new CreateOnlyRemoteBackend();

  assert.throws(
    () =>
      new SandboxBackendRegistry(
        [
          {
            adapter: backend,
            descriptor: {
              id: "remote-create-only",
              isolation: "provider_managed",
              kind: "remote_api",
              label: "Create-only remote sandbox",
              requiresCredential: true,
            },
          },
        ],
        [
          {
            backendId: "remote-create-only",
            credentialRef: "sandbox/remote/create-only",
            model: "gpt-test",
            profileVersion: "profile-v1",
            provider: "openai",
          },
        ],
        () => "unused-secret",
      ),
    (error: unknown) =>
      error instanceof SandboxError &&
      error.code === "BACKEND_INVALID" &&
      error.message.includes("deterministic cleanup"),
  );
});
