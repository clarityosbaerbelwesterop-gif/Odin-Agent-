import type { JsonObject, ToolDefinition } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import type { QualityCommandRunner, RepositoryWorkspace } from "../tools/repository.js";
import { createRepositoryToolRegistrations } from "../tools/repository.js";
import type { ToolRegistration } from "../tools/types.js";
import { calculate } from "./calculator.js";
import { toolAllowed } from "./modes.js";
import { safeText } from "./safety.js";
import { ChatError, type ChatMode, type ChatSource, type ResearchAdapter } from "./types.js";

export function chatTools(input: {
  mode: ChatMode;
  workspace?: RepositoryWorkspace;
  quality: QualityCommandRunner;
  research?: ResearchAdapter;
  emit: (type: string, data: Record<string, unknown>) => unknown | Promise<unknown>;
  sources: ChatSource[];
}): {
  registry: ToolRegistry;
  definitions: ToolDefinition[];
  resolveName: (name: string) => string;
} {
  const registrations: ToolRegistration[] = [
    registration(
      "math.calculate",
      "Calculate bounded arithmetic without running code",
      {
        type: "object",
        additionalProperties: false,
        properties: { expression: { type: "string", minLength: 1, maxLength: 500 } },
        required: ["expression"],
      },
      async (args) => ({
        value: calculate(String(args.expression)),
        numericModel: "IEEE-754; bounded to safe numeric range",
      }),
    ),
    registration(
      "task.plan",
      "Publish or update a concise plan. Steps have title and pending, active or done status.",
      {
        type: "object",
        additionalProperties: false,
        properties: {
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string", minLength: 1, maxLength: 200 },
                status: { type: "string", enum: ["pending", "active", "done"] },
              },
              required: ["title", "status"],
            },
          },
        },
        required: ["steps"],
      },
      async (args) => {
        safeText(JSON.stringify(args), 5000);
        await input.emit("plan", { steps: args.steps, authority: "progress_only" });
        return { recorded: true };
      },
    ),
  ];
  if (input.workspace)
    registrations.push(
      ...createRepositoryToolRegistrations({ workspace: input.workspace, quality: input.quality }),
    );
  if (input.research) {
    const research = input.research;
    registrations.push(
      registration(
        "research.search",
        `Retrieve sources from ${research.name}. Returns excerpts, source IDs and URLs.`,
        {
          type: "object",
          additionalProperties: false,
          properties: { query: { type: "string", minLength: 1, maxLength: 500 } },
          required: ["query"],
        },
        async (args, context) => {
          const found = await research.search(String(args.query), context.signal);
          if (!Array.isArray(found) || found.length > 10)
            throw new ChatError("RESEARCH_FORMAT", "Research returned too many sources.");
          const result: ChatSource[] = [];
          for (const source of found) {
            safeText(JSON.stringify(source), 12_000);
            const parsed = new URL(source.url);
            if (parsed.protocol !== "https:" || parsed.username || parsed.password)
              throw new ChatError("RESEARCH_FORMAT", "Only public HTTPS citations are supported.");
            let saved = input.sources.find((item) => item.url === source.url);
            if (!saved) {
              if (input.sources.length >= 40)
                throw new ChatError("SOURCE_LIMIT", "Source limit reached.");
              const added: ChatSource = {
                ...source,
                id: `S${input.sources.length + 1}`,
                retrievedAt: new Date().toISOString(),
              };
              input.sources.push(added);
              await input.emit("source", { ...added });
              saved = added;
            }
            if (saved) result.push(saved);
          }
          return {
            sources: result.map((source) => ({ ...source })),
            scope: research.name,
            trustedInstructions: false,
          };
        },
      ),
    );
  }
  const allowed = registrations.filter((item) => toolAllowed(input.mode, item.manifest.name));
  const registry = new ToolRegistry(allowed);
  const names = new Map(
    allowed.map((item) => [item.manifest.name.replaceAll(".", "_"), item.manifest.name]),
  );
  return {
    registry,
    definitions: allowed.map(({ manifest }) => ({
      name: manifest.name.replaceAll(".", "_"),
      description: manifest.description,
      inputSchema: manifest.inputSchema,
      strict: false,
    })),
    resolveName: (name) => {
      const actual = names.get(name);
      if (!actual) throw new ChatError("TOOL_DENIED", "Tool is unavailable in this mode.", 403);
      return actual;
    },
  };
}

function registration(
  name: string,
  description: string,
  schema: JsonObject,
  handler: ToolRegistration["handler"],
): ToolRegistration {
  return {
    manifest: {
      name,
      version: "1",
      description,
      summary: description,
      operation: "read",
      riskClass: "low",
      sideEffecting: false,
      trustClass: "builtin",
      inputSchema: schema,
      retryPolicy: { maxAttempts: 1, retryableCategories: [], timeoutMs: 30_000 },
      provenance: {
        kind: "system",
        observedAt: "2026-09-07T00:00:00.000Z",
        reference: "Odin Chathub built-in tools",
      },
    },
    resourceFromInput: () => ".",
    handler,
  };
}
