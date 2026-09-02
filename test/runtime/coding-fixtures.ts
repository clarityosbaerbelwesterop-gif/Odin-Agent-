import { createHash } from "node:crypto";
import type {
  CapabilityProfile,
  JsonObject,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  ProviderCallOptions,
} from "../../src/providers/types.js";
import type {
  QualityCommand,
  QualityCommandResult,
  QualityCommandRunner,
  RepositoryPatchResult,
  RepositoryReadResult,
  RepositorySearchMatch,
  RepositoryWorkspace,
} from "../../src/tools/repository.js";

export const FIXED_NOW = "2026-09-02T20:00:00.000Z";
export const TARGET_PATH = "src/math.ts";

export class ScriptedProvider implements ModelProvider {
  readonly id = "scripted";
  readonly requests: ModelRequest[] = [];
  readonly #responses: ModelResponse[];

  constructor(responses: readonly ModelResponse[]) {
    this.#responses = [...responses];
  }

  capabilities(model: string): CapabilityProfile {
    return {
      capabilities: {
        imageInput: false,
        reasoningEfforts: [],
        streaming: false,
        strictStructuredOutput: true,
        strictToolSchema: true,
        structuredOutput: true,
        temperature: false,
        textInput: true,
        toolUse: false,
      },
      model,
      provider: this.id,
      provenance: {
        kind: "project_config",
        observedAt: FIXED_NOW,
        reference: "M4 scripted provider fixture",
      },
      version: "fixture-1",
    };
  }

  async generate(
    request: ModelRequest,
    _options?: ProviderCallOptions,
  ): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    const next = this.#responses.shift();
    if (next === undefined) throw new Error("Scripted provider response queue exhausted.");
    return structuredClone(next);
  }

  async *stream(
    _request: ModelRequest,
    _options?: ProviderCallOptions,
  ): AsyncIterable<ModelStreamEvent> {
    throw new Error("M4 scripted provider streaming is intentionally unavailable.");
  }
}

export class FixtureWorkspace implements RepositoryWorkspace {
  readonly patches: Array<{ path: string; expectedSha: string; content: string }> = [];
  readonly #files = new Map<string, string>();

  constructor(files: Readonly<Record<string, string>>) {
    for (const [path, content] of Object.entries(files)) this.#files.set(path, content);
  }

  async search(input: {
    readonly query: string;
    readonly path: string;
    readonly maxResults: number;
    readonly signal: AbortSignal;
  }): Promise<readonly RepositorySearchMatch[]> {
    if (input.signal.aborted) throw new Error("Search aborted.");
    const query = input.query.toLowerCase();
    return [...this.#files.entries()]
      .filter(([path]) => input.path === "." || path === input.path || path.startsWith(`${input.path}/`))
      .filter(([, content]) => content.toLowerCase().includes(query))
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, input.maxResults)
      .map(([path, content]) => ({ line: 1, path, preview: content.slice(0, 120) }));
  }

  async read(input: {
    readonly path: string;
    readonly maxBytes: number;
    readonly signal: AbortSignal;
  }): Promise<RepositoryReadResult> {
    if (input.signal.aborted) throw new Error("Read aborted.");
    const content = this.#files.get(input.path);
    if (content === undefined) throw new Error("Fixture file does not exist.");
    const truncated = Buffer.byteLength(content, "utf8") > input.maxBytes;
    return {
      content: truncated ? content.slice(0, input.maxBytes) : content,
      sha: this.sha(input.path),
      truncated,
    };
  }

  async patch(input: {
    readonly path: string;
    readonly expectedSha: string;
    readonly content: string;
    readonly signal: AbortSignal;
  }): Promise<RepositoryPatchResult> {
    if (input.signal.aborted) throw new Error("Patch aborted.");
    if (this.sha(input.path) !== input.expectedSha) throw new Error("Fixture optimistic SHA mismatch.");
    this.patches.push({
      content: input.content,
      expectedSha: input.expectedSha,
      path: input.path,
    });
    this.#files.set(input.path, input.content);
    return { sha: this.sha(input.path) };
  }

  content(path: string): string {
    const content = this.#files.get(path);
    if (content === undefined) throw new Error(`Unknown fixture path ${path}.`);
    return content;
  }

  sha(path: string): string {
    return createHash("sha256").update(this.content(path)).digest("hex");
  }
}

export class FixtureQualityRunner implements QualityCommandRunner {
  readonly seenCommandIds: string[] = [];
  readonly #workspace: FixtureWorkspace;
  readonly #targetPath: string;

  constructor(workspace: FixtureWorkspace, targetPath = TARGET_PATH) {
    this.#workspace = workspace;
    this.#targetPath = targetPath;
  }

  commands(): readonly QualityCommand[] {
    return [{ id: "verify", label: "Fixture verification" }];
  }

  async run(commandId: string, signal: AbortSignal): Promise<QualityCommandResult> {
    if (signal.aborted) throw new Error("Quality run aborted.");
    this.seenCommandIds.push(commandId);
    if (commandId !== "verify") throw new Error("Unknown fixture quality command.");
    const content = this.#workspace.content(this.#targetPath);
    if (content.includes("return a + b;")) {
      return { exitCode: 0, output: "fixture verify passed" };
    }
    return { exitCode: 1, output: "fixture verify failed: add() must return a + b" };
  }
}

export function modelResponse(
  structuredOutput: JsonObject,
  inputTokens: number,
  outputTokens: number,
): ModelResponse {
  return {
    finishReason: "stop",
    id: `fixture-${inputTokens}-${outputTokens}`,
    message: { content: [], role: "assistant" },
    model: "fixture-model",
    provider: "scripted",
    structuredOutput,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  };
}

export function fixtureFiles(): Readonly<Record<string, string>> {
  return {
    "README.md": "A tiny math fixture. This file is irrelevant to the add implementation.",
    "dist/generated.js": "function add(a,b){return 999}",
    "node_modules/pkg/index.js": "function add(a,b){return 123}",
    "package.json": JSON.stringify({
      name: "m4-fixture",
      private: true,
      scripts: { verify: "fixture-registered-command-only" },
    }),
    [TARGET_PATH]: "export function add(a: number, b: number): number {\n  return a;\n}\n",
  };
}
