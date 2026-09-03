import assert from "node:assert/strict";
import test from "node:test";
import {
  type SandboxBackendAdapter,
  type SandboxBackendCreateRequest,
  type SandboxBackendRegistration,
  SandboxBackendRegistry,
  SandboxError,
} from "../../src/sandbox/index.js";

class RecordingBackend implements SandboxBackendAdapter {
  readonly requests: SandboxBackendCreateRequest[] = [];
  readonly #sessionId: string;

  constructor(sessionId: string) {
    this.#sessionId = sessionId;
  }

  async create(request: SandboxBackendCreateRequest) {
    this.requests.push(request);
    return {
      expiresAt: "2026-09-03T19:00:00.000Z",
      sessionId: this.#sessionId,
    };
  }
}

function registration(
  id: string,
  adapter: SandboxBackendAdapter,
  options: {
    readonly kind?: "local_process" | "remote_api";
    readonly requiresCredential?: boolean;
  } = {},
): SandboxBackendRegistration {
  const kind = options.kind ?? "remote_api";
  return {
    adapter,
    descriptor: {
      id,
      isolation: kind === "remote_api" ? "provider_managed" : "host_process",
      kind,
      label: `Sandbox ${id}`,
      requiresCredential: options.requiresCredential ?? kind === "remote_api",
    },
  };
}

function allocation(
  overrides: Partial<{
    provider: string;
    model: string;
    profileVersion: string;
  }> = {},
) {
  return {
    missionId: "mission-12",
    model: overrides.model ?? "gpt-test",
    profileVersion: overrides.profileVersion ?? "profile-v1",
    provider: overrides.provider ?? "openai",
    signal: new AbortController().signal,
    taskId: "task-sandbox",
    timeoutMs: 60_000,
  };
}

test("exact model profile selects its sandbox backend without exposing credential references", async () => {
  const remote = new RecordingBackend("session-openai");
  const resolved: string[] = [];
  const registry = new SandboxBackendRegistry(
    [registration("remote-a", remote)],
    [
      {
        backendId: "remote-a",
        credentialRef: "sandbox/key/openai/gpt-test",
        model: "gpt-test",
        profileVersion: "profile-v1",
        provider: "openai",
      },
    ],
    (reference) => {
      resolved.push(reference);
      return "sandbox-secret-value";
    },
  );

  assert.deepEqual(registry.bindings(), [
    {
      backendId: "remote-a",
      model: "gpt-test",
      profileVersion: "profile-v1",
      provider: "openai",
      requiresCredential: true,
    },
  ]);
  assert.equal(JSON.stringify(registry.bindings()).includes("sandbox/key"), false);

  const session = await registry.allocate(allocation());
  assert.equal(session.backendId, "remote-a");
  assert.equal(session.backendKind, "remote_api");
  assert.equal(session.isolation, "provider_managed");
  assert.deepEqual(resolved, ["sandbox/key/openai/gpt-test"]);
  assert.equal(remote.requests.length, 1);
  assert.equal(remote.requests[0]?.credential, "sandbox-secret-value");
  assert.equal(JSON.stringify(session).includes("sandbox-secret-value"), false);
  assert.equal(JSON.stringify(session).includes("sandbox/key"), false);
});

test("different provider/model profiles can use different sandbox backends and keys", async () => {
  const first = new RecordingBackend("session-first");
  const second = new RecordingBackend("session-second");
  const credentials = new Map([
    ["sandbox/openai", "secret-openai"],
    ["sandbox/anthropic", "secret-anthropic"],
  ]);
  const registry = new SandboxBackendRegistry(
    [registration("remote-a", first), registration("remote-b", second)],
    [
      {
        backendId: "remote-a",
        credentialRef: "sandbox/openai",
        model: "gpt-test",
        profileVersion: "profile-v1",
        provider: "openai",
      },
      {
        backendId: "remote-b",
        credentialRef: "sandbox/anthropic",
        model: "claude-test",
        profileVersion: "profile-v9",
        provider: "anthropic",
      },
    ],
    (reference) => credentials.get(reference) ?? "",
  );

  const openai = await registry.allocate(allocation());
  const anthropic = await registry.allocate(
    allocation({ model: "claude-test", profileVersion: "profile-v9", provider: "anthropic" }),
  );

  assert.equal(openai.backendId, "remote-a");
  assert.equal(anthropic.backendId, "remote-b");
  assert.equal(first.requests[0]?.credential, "secret-openai");
  assert.equal(second.requests[0]?.credential, "secret-anthropic");
  assert.equal(first.requests[0]?.model, "gpt-test");
  assert.equal(second.requests[0]?.model, "claude-test");
});

test("missing or mismatched model bindings fail before credential resolution or backend creation", async () => {
  const backend = new RecordingBackend("unused");
  let resolverCalls = 0;
  const registry = new SandboxBackendRegistry(
    [registration("remote-a", backend)],
    [
      {
        backendId: "remote-a",
        credentialRef: "sandbox/openai",
        model: "gpt-test",
        profileVersion: "profile-v1",
        provider: "openai",
      },
    ],
    () => {
      resolverCalls += 1;
      return "secret";
    },
  );

  await assert.rejects(
    registry.allocate(allocation({ profileVersion: "profile-v2" })),
    (error: unknown) => error instanceof SandboxError && error.code === "BINDING_NOT_FOUND",
  );
  await assert.rejects(
    registry.allocate(allocation({ provider: "anthropic" })),
    (error: unknown) => error instanceof SandboxError && error.code === "BINDING_NOT_FOUND",
  );
  assert.equal(resolverCalls, 0);
  assert.equal(backend.requests.length, 0);
});

test("remote credentials are validated in the control plane before reaching an adapter", async () => {
  const backend = new RecordingBackend("unused");
  const registry = new SandboxBackendRegistry(
    [registration("remote-a", backend)],
    [
      {
        backendId: "remote-a",
        credentialRef: "sandbox/openai",
        model: "gpt-test",
        profileVersion: "profile-v1",
        provider: "openai",
      },
    ],
    () => "invalid\ncredential",
  );

  await assert.rejects(
    registry.allocate(allocation()),
    (error: unknown) => error instanceof SandboxError && error.code === "CREDENTIAL_INVALID",
  );
  assert.equal(backend.requests.length, 0);
});

test("local process backends cannot be configured with remote credential references", () => {
  const local = new RecordingBackend("local-session");
  assert.throws(
    () =>
      new SandboxBackendRegistry(
        [registration("local", local, { kind: "local_process", requiresCredential: false })],
        [
          {
            backendId: "local",
            credentialRef: "must-not-exist",
            model: "local-model",
            profileVersion: "v1",
            provider: "local",
          },
        ],
        () => "unused",
      ),
    (error: unknown) => error instanceof SandboxError && error.code === "BACKEND_INVALID",
  );
});

test("duplicate bindings and unknown backends fail closed at registry construction", () => {
  const backend = new RecordingBackend("unused");
  const binding = {
    backendId: "remote-a",
    credentialRef: "sandbox/openai",
    model: "gpt-test",
    profileVersion: "profile-v1",
    provider: "openai",
  } as const;

  assert.throws(
    () =>
      new SandboxBackendRegistry(
        [registration("remote-a", backend)],
        [binding, binding],
        () => "secret",
      ),
    (error: unknown) => error instanceof SandboxError && error.code === "BACKEND_INVALID",
  );
  assert.throws(
    () =>
      new SandboxBackendRegistry(
        [registration("remote-a", backend)],
        [{ ...binding, backendId: "missing" }],
        () => "secret",
      ),
    (error: unknown) => error instanceof SandboxError && error.code === "BACKEND_NOT_FOUND",
  );
});

test("sandbox selection identity is deterministic and does not depend on secret contents", async () => {
  const firstBackend = new RecordingBackend("stable-session");
  const secondBackend = new RecordingBackend("stable-session");
  const binding = {
    backendId: "remote-a",
    credentialRef: "sandbox/openai",
    model: "gpt-test",
    profileVersion: "profile-v1",
    provider: "openai",
  } as const;
  const first = new SandboxBackendRegistry(
    [registration("remote-a", firstBackend)],
    [binding],
    () => "first-secret",
  );
  const second = new SandboxBackendRegistry(
    [registration("remote-a", secondBackend)],
    [binding],
    () => "different-secret",
  );

  const left = await first.allocate(allocation());
  const right = await second.allocate(allocation());
  assert.equal(left.selectionHash, right.selectionHash);
  assert.equal(left.selectionHash.length, 64);
});
