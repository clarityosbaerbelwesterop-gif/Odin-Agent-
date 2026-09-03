import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CanonicalWorkspaceBoundary,
  NodeProcessAdapter,
  type ProcessAdapter,
  SandboxError,
  type SandboxCommandDefinition,
  SandboxProcessRunner,
  type SpawnRequest,
} from "../../src/sandbox/index.js";

async function processWorkspace(): Promise<{
  readonly cleanup: () => Promise<void>;
  readonly workspace: CanonicalWorkspaceBoundary;
}> {
  const base = await mkdtemp(join(tmpdir(), "odin-m12-process-"));
  const root = join(base, "root");
  await mkdir(root);
  return {
    cleanup: () => rm(base, { force: true, recursive: true }),
    workspace: await CanonicalWorkspaceBoundary.create(root),
  };
}

function command(
  id: string,
  overrides: Partial<SandboxCommandDefinition> = {},
): SandboxCommandDefinition {
  return {
    args: ["--version"],
    cwd: ".",
    executable: process.execPath,
    fixedEnv: {},
    id,
    inheritEnv: [],
    label: id,
    maxStderrBytes: 4_096,
    maxStdoutBytes: 4_096,
    network: "deny",
    timeoutMs: 1_000,
    ...overrides,
  };
}

class RecordingAdapter implements ProcessAdapter {
  readonly requests: SpawnRequest[] = [];
  readonly #result: Awaited<ReturnType<ProcessAdapter["run"]>>;

  constructor(result: Awaited<ReturnType<ProcessAdapter["run"]>> = successfulResult()) {
    this.#result = result;
  }

  async run(request: SpawnRequest): Promise<Awaited<ReturnType<ProcessAdapter["run"]>>> {
    this.requests.push(request);
    return this.#result;
  }
}

test("runner passes only registered fixed process data and explicit environment", async () => {
  const fixture = await processWorkspace();
  try {
    const adapter = new RecordingAdapter();
    const runner = new SandboxProcessRunner(
      fixture.workspace,
      adapter,
      [command("check", { fixedEnv: { FIXED_FLAG: "fixed" }, inheritEnv: ["SAFE_FLAG"] })],
      { hostEnv: { PRIVATE_VALUE: "hidden", SAFE_FLAG: "allowed" }, maxConcurrent: 1 },
    );

    const result = await runner.run("check", new AbortController().signal);
    assert.equal(result.outcome, "EXITED");
    assert.equal(adapter.requests.length, 1);
    const request = adapter.requests[0];
    assert.ok(request);
    assert.equal(request.executable, process.execPath);
    assert.deepEqual(request.args, ["--version"]);
    assert.deepEqual(request.env, { FIXED_FLAG: "fixed", SAFE_FLAG: "allowed" });
    assert.equal("PRIVATE_VALUE" in request.env, false);
    assert.equal(request.cwd, fixture.workspace.canonicalRoot);
  } finally {
    await fixture.cleanup();
  }
});

test("real Node adapter executes one trusted fixed command without a shell", async () => {
  const fixture = await processWorkspace();
  try {
    const runner = new SandboxProcessRunner(
      fixture.workspace,
      new NodeProcessAdapter(),
      [command("node-version")],
      { maxConcurrent: 1 },
    );
    const result = await runner.run("node-version", new AbortController().signal);
    assert.equal(result.outcome, "EXITED");
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /^v\d+\./u);
  } finally {
    await fixture.cleanup();
  }
});

test("unknown and network-capable host commands fail before adapter execution", async () => {
  const fixture = await processWorkspace();
  try {
    const adapter = new RecordingAdapter();
    const runner = new SandboxProcessRunner(
      fixture.workspace,
      adapter,
      [command("networked", { network: "policy_required" })],
      { maxConcurrent: 1 },
    );
    await assert.rejects(
      runner.run("missing", new AbortController().signal),
      (error: unknown) => error instanceof SandboxError && error.code === "COMMAND_NOT_FOUND",
    );
    await assert.rejects(
      runner.run("networked", new AbortController().signal),
      (error: unknown) => error instanceof SandboxError && error.code === "COMMAND_INVALID",
    );
    assert.equal(adapter.requests.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

test("pre-cancellation returns typed cancellation without reaching the adapter", async () => {
  const fixture = await processWorkspace();
  try {
    const adapter = new RecordingAdapter();
    const runner = new SandboxProcessRunner(fixture.workspace, adapter, [command("cancel")], {
      maxConcurrent: 1,
    });
    const controller = new AbortController();
    controller.abort();
    const result = await runner.run("cancel", controller.signal);
    assert.equal(result.outcome, "CANCELLED");
    assert.equal(result.durationMs, 0);
    assert.equal(adapter.requests.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

test("concurrency ceiling rejects a second active command", async () => {
  const fixture = await processWorkspace();
  let release: (() => void) | undefined;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });
  const adapter: ProcessAdapter = {
    async run() {
      await blocker;
      return successfulResult();
    },
  };
  try {
    const runner = new SandboxProcessRunner(
      fixture.workspace,
      adapter,
      [command("one"), command("two")],
      { maxConcurrent: 1 },
    );
    const first = runner.run("one", new AbortController().signal);
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(
      runner.run("two", new AbortController().signal),
      (error: unknown) => error instanceof SandboxError && error.code === "CONCURRENCY_EXCEEDED",
    );
    release?.();
    assert.equal((await first).outcome, "EXITED");
  } finally {
    release?.();
    await fixture.cleanup();
  }
});

test("command registration rejects relative executables and ambiguous environment", async () => {
  const fixture = await processWorkspace();
  try {
    assert.throws(
      () =>
        new SandboxProcessRunner(
          fixture.workspace,
          new RecordingAdapter(),
          [command("bad", { executable: "node" })],
          { maxConcurrent: 1 },
        ),
      (error: unknown) => error instanceof SandboxError && error.code === "COMMAND_INVALID",
    );
    assert.throws(
      () =>
        new SandboxProcessRunner(
          fixture.workspace,
          new RecordingAdapter(),
          [command("duplicate-env", { fixedEnv: { SAFE_FLAG: "fixed" }, inheritEnv: ["SAFE_FLAG"] })],
          { maxConcurrent: 1 },
        ),
      (error: unknown) => error instanceof SandboxError && error.code === "COMMAND_INVALID",
    );
  } finally {
    await fixture.cleanup();
  }
});

function successfulResult(): Awaited<ReturnType<ProcessAdapter["run"]>> {
  return Object.freeze({
    durationMs: 1,
    exitCode: 0,
    outcome: "EXITED",
    signal: null,
    stderr: "",
    stderrTruncated: false,
    stdout: "ok",
    stdoutTruncated: false,
  });
}
