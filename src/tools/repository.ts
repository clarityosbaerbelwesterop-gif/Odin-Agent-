import type { JsonObject, JsonValue } from "../providers/types.js";
import { type ToolManifest, type ToolRegistration, ToolRuntimeError } from "./types.js";

export interface RepositorySearchMatch {
  readonly path: string;
  readonly line: number;
  readonly preview: string;
}

export interface RepositoryReadResult {
  readonly content: string;
  readonly truncated: boolean;
  readonly sha?: string;
}

export interface RepositoryPatchResult {
  readonly sha: string;
}

export interface RepositoryWorkspace {
  search(input: {
    readonly query: string;
    readonly path: string;
    readonly maxResults: number;
    readonly signal: AbortSignal;
  }): Promise<readonly RepositorySearchMatch[]>;
  read(input: {
    readonly path: string;
    readonly maxBytes: number;
    readonly signal: AbortSignal;
  }): Promise<RepositoryReadResult>;
  patch(input: {
    readonly path: string;
    readonly expectedSha: string;
    readonly content: string;
    readonly signal: AbortSignal;
  }): Promise<RepositoryPatchResult>;
}

export interface QualityCommand {
  readonly id: string;
  readonly label: string;
}

export interface QualityCommandResult {
  readonly exitCode: number;
  readonly output: string;
}

export interface QualityCommandRunner {
  commands(): readonly QualityCommand[];
  run(commandId: string, signal: AbortSignal): Promise<QualityCommandResult>;
}

export interface RepositoryToolDependencies {
  readonly workspace: RepositoryWorkspace;
  readonly quality: QualityCommandRunner;
}

export function createRepositoryToolRegistrations(
  dependencies: RepositoryToolDependencies,
): readonly ToolRegistration[] {
  validateQualityCommands(dependencies.quality.commands());
  return [
    repositorySearchRegistration(dependencies.workspace),
    repositoryReadRegistration(dependencies.workspace),
    repositoryPatchRegistration(dependencies.workspace),
    repositoryQualityRegistration(dependencies.quality),
  ];
}

export function normalizeWorkspacePath(value: string, allowRoot = false): string {
  if (value.trim() === "") invalidPath("Workspace path must be non-empty.");
  if (value.includes("\u0000") || value.includes("\\")) {
    invalidPath("Workspace paths must not contain NUL bytes or backslashes.");
  }
  if (value.startsWith("/") || /^[A-Za-z]:/u.test(value)) {
    invalidPath("Absolute workspace paths are not allowed.");
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "..")) {
    invalidPath("Workspace path traversal is not allowed.");
  }
  const normalized = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (normalized === "") {
    if (allowRoot) return ".";
    invalidPath("A file path is required for this repository tool.");
  }
  return normalized;
}

function repositorySearchRegistration(workspace: RepositoryWorkspace): ToolRegistration {
  return {
    manifest: manifest({
      description: "Search text inside the scoped repository workspace.",
      inputSchema: {
        additionalProperties: false,
        properties: {
          maxResults: { maximum: 100, minimum: 1, type: "integer" },
          path: { maxLength: 500, minLength: 1, type: "string" },
          query: { maxLength: 500, minLength: 1, type: "string" },
        },
        required: ["maxResults", "path", "query"],
        type: "object",
      },
      name: "repo.search",
      operation: "search",
      riskClass: "low",
      sideEffecting: false,
      summary: "Search repository text",
    }),
    resourceFromInput: (input) => normalizeWorkspacePath(stringField(input, "path"), true),
    handler: async (input, context) => {
      const matches = await workspace.search({
        maxResults: integerField(input, "maxResults"),
        path: normalizeWorkspacePath(stringField(input, "path"), true),
        query: stringField(input, "query"),
        signal: context.signal,
      });
      return {
        matches: matches.map((match) => ({
          line: match.line,
          path: match.path,
          preview: match.preview,
        })),
      };
    },
  };
}

function repositoryReadRegistration(workspace: RepositoryWorkspace): ToolRegistration {
  return {
    manifest: manifest({
      description: "Read a bounded file from the scoped repository workspace.",
      inputSchema: {
        additionalProperties: false,
        properties: {
          maxBytes: { maximum: 1048576, minimum: 1, type: "integer" },
          path: { maxLength: 500, minLength: 1, type: "string" },
        },
        required: ["maxBytes", "path"],
        type: "object",
      },
      name: "repo.read",
      operation: "read",
      riskClass: "low",
      sideEffecting: false,
      summary: "Read repository file",
    }),
    resourceFromInput: (input) => normalizeWorkspacePath(stringField(input, "path")),
    handler: async (input, context) => {
      const result = await workspace.read({
        maxBytes: integerField(input, "maxBytes"),
        path: normalizeWorkspacePath(stringField(input, "path")),
        signal: context.signal,
      });
      return {
        content: result.content,
        truncated: result.truncated,
        ...(result.sha === undefined ? {} : { sha: result.sha }),
      };
    },
  };
}

function repositoryPatchRegistration(workspace: RepositoryWorkspace): ToolRegistration {
  return {
    manifest: manifest({
      description: "Replace one bounded repository file through the injected workspace adapter.",
      inputSchema: {
        additionalProperties: false,
        properties: {
          content: { maxLength: 1048576, minLength: 0, type: "string" },
          expectedSha: { maxLength: 128, minLength: 1, type: "string" },
          path: { maxLength: 500, minLength: 1, type: "string" },
        },
        required: ["content", "expectedSha", "path"],
        type: "object",
      },
      name: "repo.patch",
      operation: "write",
      riskClass: "medium",
      sideEffecting: true,
      summary: "Patch repository file",
    }),
    resourceFromInput: (input) => normalizeWorkspacePath(stringField(input, "path")),
    handler: async (input, context) => {
      const result = await workspace.patch({
        content: stringField(input, "content"),
        expectedSha: stringField(input, "expectedSha"),
        path: normalizeWorkspacePath(stringField(input, "path")),
        signal: context.signal,
      });
      return { sha: result.sha };
    },
  };
}

function repositoryQualityRegistration(quality: QualityCommandRunner): ToolRegistration {
  const knownCommands = new Set(quality.commands().map((command) => command.id));
  return {
    manifest: manifest({
      description: "Run one pre-discovered repository quality command by stable command ID.",
      inputSchema: {
        additionalProperties: false,
        properties: {
          commandId: { maxLength: 100, minLength: 1, type: "string" },
        },
        required: ["commandId"],
        type: "object",
      },
      name: "repo.quality",
      operation: "execute",
      riskClass: "medium",
      sideEffecting: true,
      summary: "Run registered quality command",
    }),
    resourceFromInput: (input) => qualityResource(knownCommands, stringField(input, "commandId")),
    handler: async (input, context) => {
      const commandId = stringField(input, "commandId");
      qualityResource(knownCommands, commandId);
      const result = await quality.run(commandId, context.signal);
      if (!Number.isSafeInteger(result.exitCode)) {
        throw new ToolRuntimeError(
          "handler_error",
          "Quality command returned an invalid exit code.",
        );
      }
      return { exitCode: result.exitCode, output: result.output };
    },
  };
}

function qualityResource(knownCommands: ReadonlySet<string>, commandId: string): string {
  if (!knownCommands.has(commandId)) {
    throw new ToolRuntimeError("invalid_input", "Unknown quality command ID.", false);
  }
  return `quality/${commandId}`;
}

function manifest(input: {
  readonly name: string;
  readonly summary: string;
  readonly description: string;
  readonly riskClass: ToolManifest["riskClass"];
  readonly operation: ToolManifest["operation"];
  readonly sideEffecting: boolean;
  readonly inputSchema: JsonObject;
}): ToolManifest {
  return {
    ...input,
    provenance: {
      kind: "system",
      observedAt: "2026-09-02T00:00:00.000Z",
      reference: "Odin M3 built-in repository tools",
    },
    retryPolicy: {
      maxAttempts: input.sideEffecting ? 1 : 2,
      retryableCategories: input.sideEffecting ? [] : ["retryable", "timeout"],
      timeoutMs: 30_000,
    },
    trustClass: "builtin",
    version: "1",
  };
}

function validateQualityCommands(commands: readonly QualityCommand[]): void {
  const ids = new Set<string>();
  for (const command of commands) {
    if (!/^[A-Za-z0-9_.-]{1,100}$/u.test(command.id) || command.label.trim() === "") {
      throw new TypeError("Quality commands require a stable ID and non-empty label.");
    }
    if (ids.has(command.id)) throw new TypeError(`Duplicate quality command ID: ${command.id}.`);
    ids.add(command.id);
  }
}

function stringField(input: JsonObject, name: string): string {
  const value = input[name];
  if (typeof value !== "string") {
    throw new ToolRuntimeError("invalid_input", `${name} must be a string.`, false);
  }
  return value;
}

function integerField(input: JsonObject, name: string): number {
  const value = input[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ToolRuntimeError("invalid_input", `${name} must be a safe integer.`, false);
  }
  return value;
}

function invalidPath(message: string): never {
  throw new ToolRuntimeError("invalid_input", message, false);
}

export function jsonObject(value: JsonValue): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolRuntimeError("invalid_input", "Expected JSON object.", false);
  }
  return value;
}
