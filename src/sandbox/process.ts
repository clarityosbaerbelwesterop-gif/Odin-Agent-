import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import {
  type HostEnvironment,
  type ProcessAdapter,
  type SandboxCommandDefinition,
  SandboxError,
  type SandboxProcessResult,
  type SandboxProcessRunnerOptions,
  type SpawnRequest,
} from "./types.js";
import { type CanonicalWorkspaceBoundary, normalizeRelativePath } from "./workspace.js";

const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_BYTES = 8_192;
const MAX_ENVIRONMENT_ENTRIES = 64;
const MAX_ENVIRONMENT_VALUE_BYTES = 32_768;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_TIMEOUT_MS = 5 * 60_000;

export class SandboxProcessRunner {
  readonly #workspace: CanonicalWorkspaceBoundary;
  readonly #adapter: ProcessAdapter;
  readonly #commands = new Map<string, SandboxCommandDefinition>();
  readonly #hostEnv: HostEnvironment;
  readonly #maxConcurrent: number;
  #active = 0;

  constructor(
    workspace: CanonicalWorkspaceBoundary,
    adapter: ProcessAdapter,
    commands: readonly SandboxCommandDefinition[],
    options: SandboxProcessRunnerOptions,
  ) {
    this.#workspace = workspace;
    this.#adapter = adapter;
    this.#maxConcurrent = positiveInteger(options.maxConcurrent, "maxConcurrent", 64);
    this.#hostEnv = options.hostEnv ?? Object.freeze({});
    for (const command of commands) {
      const normalized = normalizeCommand(command);
      if (this.#commands.has(normalized.id)) {
        throw new SandboxError(
          "COMMAND_INVALID",
          `Duplicate sandbox command ID: ${normalized.id}.`,
        );
      }
      this.#commands.set(normalized.id, normalized);
    }
  }

  commands(): readonly Pick<SandboxCommandDefinition, "id" | "label">[] {
    return Object.freeze(
      [...this.#commands.values()]
        .map(({ id, label }) => Object.freeze({ id, label }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    );
  }

  async run(commandId: string, signal: AbortSignal): Promise<SandboxProcessResult> {
    const command = this.#commands.get(commandId);
    if (command === undefined) {
      throw new SandboxError("COMMAND_NOT_FOUND", "Unknown sandbox command ID.");
    }
    if (command.network !== "deny") {
      throw new SandboxError(
        "COMMAND_INVALID",
        "Network-capable subprocesses require a stronger M12 transport/isolation boundary.",
      );
    }
    if (signal.aborted) return cancelledResult(command.id);
    if (this.#active >= this.#maxConcurrent) {
      throw new SandboxError("CONCURRENCY_EXCEEDED", "Sandbox process concurrency limit reached.");
    }

    // Reserve synchronously before the first await so concurrent callers cannot both pass the ceiling.
    this.#active += 1;
    try {
      const cwd = await this.#workspace.resolveDirectory(command.cwd);
      const env = buildEnvironment(command, this.#hostEnv);
      const result = await this.#adapter.run({
        args: command.args,
        cwd: cwd.canonicalPath,
        env,
        executable: command.executable,
        maxStderrBytes: command.maxStderrBytes,
        maxStdoutBytes: command.maxStdoutBytes,
        signal,
        timeoutMs: command.timeoutMs,
      });
      return Object.freeze({ commandId: command.id, ...result });
    } finally {
      this.#active -= 1;
    }
  }
}

export class NodeProcessAdapter implements ProcessAdapter {
  async run(request: SpawnRequest): Promise<Omit<SandboxProcessResult, "commandId">> {
    if (request.signal.aborted) return stripCommandId(cancelledResult("unused"));
    const startedAt = Date.now();

    return new Promise((resolvePromise, rejectPromise) => {
      let override: "CANCELLED" | "OUTPUT_LIMIT" | "TIMED_OUT" | null = null;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stdoutTruncated = false;
      let stderrTruncated = false;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let finished = false;

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(request.executable, [...request.args], {
          cwd: request.cwd,
          env: { ...request.env },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        rejectPromise(new SandboxError("PROCESS_SPAWN_FAILED", "Sandbox process could not start."));
        return;
      }

      const terminate = (reason: "CANCELLED" | "OUTPUT_LIMIT" | "TIMED_OUT"): void => {
        if (override === null) override = reason;
        if (!child.killed) child.kill("SIGKILL");
      };

      const timeout = setTimeout(() => terminate("TIMED_OUT"), request.timeoutMs);
      const onAbort = (): void => terminate("CANCELLED");
      request.signal.addEventListener("abort", onAbort, { once: true });

      child.stdout?.on("data", (value: Buffer | string) => {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        const remaining = Math.max(0, request.maxStdoutBytes - stdoutBytes);
        if (chunk.length > remaining) {
          if (remaining > 0) stdout.push(chunk.subarray(0, remaining));
          stdoutBytes += remaining;
          stdoutTruncated = true;
          terminate("OUTPUT_LIMIT");
          return;
        }
        stdout.push(chunk);
        stdoutBytes += chunk.length;
      });

      child.stderr?.on("data", (value: Buffer | string) => {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        const remaining = Math.max(0, request.maxStderrBytes - stderrBytes);
        if (chunk.length > remaining) {
          if (remaining > 0) stderr.push(chunk.subarray(0, remaining));
          stderrBytes += remaining;
          stderrTruncated = true;
          terminate("OUTPUT_LIMIT");
          return;
        }
        stderr.push(chunk);
        stderrBytes += chunk.length;
      });

      child.once("error", () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        request.signal.removeEventListener("abort", onAbort);
        rejectPromise(new SandboxError("PROCESS_SPAWN_FAILED", "Sandbox process could not start."));
      });

      child.once("close", (exitCode, childSignal) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        request.signal.removeEventListener("abort", onAbort);
        const outcome =
          override ?? (childSignal === null ? ("EXITED" as const) : ("SIGNALED" as const));
        resolvePromise(
          Object.freeze({
            durationMs: Math.max(0, Date.now() - startedAt),
            exitCode,
            outcome,
            signal: childSignal,
            stderr: Buffer.concat(stderr).toString("utf8"),
            stderrTruncated,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stdoutTruncated,
          }),
        );
      });
    });
  }
}

function normalizeCommand(value: SandboxCommandDefinition): SandboxCommandDefinition {
  if (typeof value !== "object" || value === null) {
    throw new SandboxError("COMMAND_INVALID", "Sandbox command must be an object.");
  }
  if (!/^[A-Za-z0-9_.-]{1,100}$/u.test(value.id) || value.label.trim() === "") {
    throw new SandboxError("COMMAND_INVALID", "Sandbox command requires a stable ID and label.");
  }
  if (!isAbsolute(value.executable) || value.executable.includes("\u0000")) {
    throw new SandboxError("COMMAND_INVALID", "Sandbox executable must be an absolute host path.");
  }
  if (!Array.isArray(value.args) || value.args.length > MAX_ARGUMENTS) {
    throw new SandboxError("COMMAND_INVALID", "Sandbox command argument list is malformed.");
  }
  const args = value.args.map((argument) =>
    boundedText(argument, "command argument", MAX_ARGUMENT_BYTES),
  );
  const cwd = normalizeRelativePath(value.cwd, true);
  const timeoutMs = positiveInteger(value.timeoutMs, "timeoutMs", MAX_TIMEOUT_MS);
  const maxStdoutBytes = positiveInteger(value.maxStdoutBytes, "maxStdoutBytes", MAX_OUTPUT_BYTES);
  const maxStderrBytes = positiveInteger(value.maxStderrBytes, "maxStderrBytes", MAX_OUTPUT_BYTES);
  if (value.network !== "deny" && value.network !== "policy_required") {
    throw new SandboxError("COMMAND_INVALID", "Sandbox network mode is unsupported.");
  }

  const inheritEnv = normalizeEnvironmentNames(value.inheritEnv);
  const fixedEntries = Object.entries(value.fixedEnv);
  if (fixedEntries.length > MAX_ENVIRONMENT_ENTRIES) {
    throw new SandboxError("COMMAND_INVALID", "Sandbox fixed environment is too large.");
  }
  const fixedEnv: Record<string, string> = {};
  for (const [name, rawValue] of fixedEntries) {
    validateEnvironmentName(name);
    if (inheritEnv.includes(name)) {
      throw new SandboxError(
        "COMMAND_INVALID",
        "Fixed and inherited environment names must be disjoint.",
      );
    }
    fixedEnv[name] = boundedText(rawValue, "environment value", MAX_ENVIRONMENT_VALUE_BYTES);
  }

  return Object.freeze({
    args: Object.freeze(args),
    cwd,
    executable: value.executable,
    fixedEnv: Object.freeze(fixedEnv),
    id: value.id,
    inheritEnv,
    label: value.label,
    maxStderrBytes,
    maxStdoutBytes,
    network: value.network,
    timeoutMs,
  });
}

function normalizeEnvironmentNames(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_ENVIRONMENT_ENTRIES) {
    throw new SandboxError("COMMAND_INVALID", "Inherited environment allowlist is malformed.");
  }
  const names = value.map((name) => {
    validateEnvironmentName(name);
    return name;
  });
  if (new Set(names).size !== names.length) {
    throw new SandboxError(
      "COMMAND_INVALID",
      "Inherited environment allowlist contains duplicates.",
    );
  }
  return Object.freeze([...names].sort());
}

function buildEnvironment(
  command: SandboxCommandDefinition,
  hostEnv: HostEnvironment,
): Readonly<Record<string, string>> {
  const env: Record<string, string> = { ...command.fixedEnv };
  for (const name of command.inheritEnv) {
    const value = hostEnv[name];
    if (value !== undefined) env[name] = value;
  }
  return Object.freeze(env);
}

function validateEnvironmentName(value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(value)) {
    throw new SandboxError("COMMAND_INVALID", "Environment variable name is invalid.");
  }
}

function boundedText(value: string, label: string, maximumBytes: number): string {
  if (
    typeof value !== "string" ||
    value.includes("\u0000") ||
    Buffer.byteLength(value) > maximumBytes
  ) {
    throw new SandboxError("COMMAND_INVALID", `${label} is malformed or exceeds its byte bound.`);
  }
  return value;
}

function positiveInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new SandboxError("COMMAND_INVALID", `${label} must be a bounded positive integer.`);
  }
  return value;
}

function cancelledResult(commandId: string): SandboxProcessResult {
  return Object.freeze({
    commandId,
    durationMs: 0,
    exitCode: null,
    outcome: "CANCELLED",
    signal: null,
    stderr: "",
    stderrTruncated: false,
    stdout: "",
    stdoutTruncated: false,
  });
}

function stripCommandId(value: SandboxProcessResult): Omit<SandboxProcessResult, "commandId"> {
  const { commandId: _commandId, ...result } = value;
  return Object.freeze(result);
}
