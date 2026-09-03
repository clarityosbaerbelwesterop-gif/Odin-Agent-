import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CanonicalWorkspaceBoundary,
  NodeProcessAdapter,
  type ProcessAdapter,
  type SandboxCommandDefinition,
  SandboxError,
  SandboxProcessRunner,
} from "../../src/sandbox/index.js";

async function workspaceFixture(): Promise<{
  readonly cleanup: () => Promise<void>;
  readonly root: string;
  readonly workspace: CanonicalWorkspaceBoundary;
}> {
  const base = await mkdtemp(join(tmpdir(), "odin-m12-process-hardening-"));
  const root = join(base, "root");
  await mkdir(root);
  return {
    cleanup: () => rm(base, { force: true, recursive: true }),
    root,
    workspace: await CanonicalWorkspaceBoundary.create(root),
  };
}

function definition(id: string, cwd = "."): SandboxCommandDefinition {
  return {
    args: ["--version"],
    cwd,
    executable: process.execPath,
    fixedEnv: {},
    id,
    inheritEnv: [],
    label: id,
    maxStderrBytes: 4_096,
    maxStdoutBytes: 4_096,
    network: "deny",
    timeoutMs: 1_000,
  };
}

function spawnRequest(
  root: string,
  overrides: Partial<{
    readonly args: readonly string[];
    readonly maxStderrBytes: number;
    readonly maxStdoutBytes: number;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
  }> = {},
) {
  return {
    args: overrides.args ?? ["--version"],
    cwd: root,
    env: {},
    executable: process.execPath,
    maxStderrBytes: overrides.maxStderrBytes ?? 4_096,
    maxStdoutBytes: overrides.maxStdoutBytes ?? 4_096,
    signal: overrides.signal ?? new AbortController().signal,
    timeoutMs: overrides.timeoutMs ?? 1_000,
  };
}

test("real process adapter kills a command at its runtime timeout", async () => {
  const fixture = await workspaceFixture();
  try {
    const adapter = new NodeProcessAdapter();
    const result = await adapter.run(
      spawnRequest(fixture.root, {
        args: ["-e", "setInterval(() => {}, 1000)"],
        timeoutMs: 25,
      }),
    );
    assert.equal(result.outcome, "TIMED_OUT");
    assert.equal(result.exitCode, null);
    assert.ok(result.durationMs >= 0);
  } finally {
    await fixture.cleanup();
  }
});

test("real process adapter truncates output and terminates an output flood", async () => {
  const fixture = await workspaceFixture();
  try {
    const adapter = new NodeProcessAdapter();
    const result = await adapter.run(
      spawnRequest(fixture.root, {
        args: ["-e", 'process.stdout.write("x".repeat(4096))'],
        maxStdoutBytes: 128,
      }),
    );
    assert.equal(result.outcome, "OUTPUT_LIMIT");
    assert.equal(result.stdoutTruncated, true);
    assert.equal(Buffer.byteLength(result.stdout), 128);
  } finally {
    await fixture.cleanup();
  }
});

test("real process adapter converts an in-flight abort into cancellation", async () => {
  const fixture = await workspaceFixture();
  try {
    const adapter = new NodeProcessAdapter();
    const controller = new AbortController();
    const pending = adapter.run(
      spawnRequest(fixture.root, {
        args: ["-e", "setInterval(() => {}, 1000)"],
        signal: controller.signal,
        timeoutMs: 2_000,
      }),
    );
    setTimeout(() => controller.abort(), 25);
    const result = await pending;
    assert.equal(result.outcome, "CANCELLED");
    assert.equal(result.exitCode, null);
  } finally {
    await fixture.cleanup();
  }
});

test("runner releases its reserved concurrency slot when canonical cwd resolution fails", async () => {
  const fixture = await workspaceFixture();
  const adapter: ProcessAdapter = {
    async run() {
      return {
        durationMs: 1,
        exitCode: 0,
        outcome: "EXITED",
        signal: null,
        stderr: "",
        stderrTruncated: false,
        stdout: "ok",
        stdoutTruncated: false,
      };
    },
  };
  try {
    const runner = new SandboxProcessRunner(
      fixture.workspace,
      adapter,
      [definition("missing-cwd", "does-not-exist"), definition("healthy")],
      { maxConcurrent: 1 },
    );

    await assert.rejects(
      runner.run("missing-cwd", new AbortController().signal),
      (error: unknown) => error instanceof SandboxError && error.code === "PATH_INVALID",
    );
    const healthy = await runner.run("healthy", new AbortController().signal);
    assert.equal(healthy.outcome, "EXITED");
  } finally {
    await fixture.cleanup();
  }
});
