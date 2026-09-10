import type { JsonObject, JsonValue } from "../providers/types.js";
import { type ToolRegistration, ToolRuntimeError } from "./types.js";

export const GITHUB_MCP_READONLY_URL = "https://api.githubcopilot.com/mcp/readonly";
const ALLOWED_TOOLS = new Set([
  "get_file_contents",
  "search_code",
  "get_pull_request",
  "get_pull_request_files",
  "get_pull_request_status",
  "list_commits",
  "list_pull_requests",
]);
const MAX_RESPONSE_BYTES = 1_000_000;

export type McpTransport = (url: string, init: RequestInit) => Promise<Response>;

export class GitHubMcpClient {
  #id = 0;
  constructor(
    readonly token: string,
    readonly transport: McpTransport = fetch,
    readonly endpoint = GITHUB_MCP_READONLY_URL,
  ) {
    if (endpoint !== GITHUB_MCP_READONLY_URL)
      throw new ToolRuntimeError("denied", "GitHub MCP endpoint is not approved.");
    if (!token || /[\r\n]/u.test(token))
      throw new ToolRuntimeError("invalid_input", "GitHub credential is invalid.");
  }

  async initialize(signal?: AbortSignal): Promise<void> {
    await this.#request(
      "initialize",
      {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "odin-agent", version: "1" },
      },
      signal,
    );
  }

  async registrations(signal?: AbortSignal): Promise<readonly ToolRegistration[]> {
    await this.initialize(signal);
    const result = await this.#request("tools/list", {}, signal);
    const tools = (result as { tools?: unknown }).tools;
    if (!Array.isArray(tools))
      throw new ToolRuntimeError("handler_error", "Invalid MCP tool list.");
    return tools.flatMap((value): ToolRegistration[] => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const tool = value as { name?: unknown; description?: unknown; inputSchema?: unknown };
      if (typeof tool.name !== "string" || !ALLOWED_TOOLS.has(tool.name)) return [];
      if (
        !tool.inputSchema ||
        typeof tool.inputSchema !== "object" ||
        Array.isArray(tool.inputSchema)
      )
        return [];
      const remoteName = tool.name;
      return [
        {
          manifest: {
            name: `github.mcp.${remoteName}`,
            version: "1",
            summary: `Read GitHub repository context with ${remoteName}`,
            description:
              typeof tool.description === "string"
                ? tool.description.slice(0, 1000)
                : "Audited read-only GitHub MCP operation.",
            operation: remoteName.includes("search") ? "search" : "read",
            riskClass: "low",
            sideEffecting: false,
            inputSchema: structuredClone(tool.inputSchema) as JsonObject,
            retryPolicy: { maxAttempts: 1, timeoutMs: 15_000, retryableCategories: [] },
            provenance: {
              kind: "system",
              reference: GITHUB_MCP_READONLY_URL,
              observedAt: new Date().toISOString(),
            },
            trustClass: "builtin",
          },
          resourceFromInput: (input) => JSON.stringify(input).slice(0, 1000),
          handler: async (input, context) => this.call(remoteName, input, context.signal),
        },
      ];
    });
  }

  async call(name: string, args: JsonObject, signal?: AbortSignal): Promise<JsonValue> {
    if (!ALLOWED_TOOLS.has(name))
      throw new ToolRuntimeError("denied", "GitHub MCP write or unknown tool was rejected.");
    const result = await this.#request("tools/call", { name, arguments: args }, signal);
    return structuredClone(result) as JsonValue;
  }

  async #request(method: string, params: JsonObject, signal?: AbortSignal): Promise<JsonValue> {
    const id = ++this.#id;
    const timeout = AbortSignal.timeout(15_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.transport(this.endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        redirect: "error",
        signal: combined,
      });
    } catch {
      throw new ToolRuntimeError(
        combined.aborted ? "timeout" : "handler_error",
        "GitHub MCP request failed.",
      );
    }
    if (!response.ok)
      throw new ToolRuntimeError("handler_error", `GitHub MCP returned HTTP ${response.status}.`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_RESPONSE_BYTES)
      throw new ToolRuntimeError("handler_error", "GitHub MCP response was too large.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES)
      throw new ToolRuntimeError("handler_error", "GitHub MCP response was too large.");
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new ToolRuntimeError("handler_error", "GitHub MCP returned malformed JSON.");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new ToolRuntimeError("handler_error", "GitHub MCP response was invalid.");
    const message = payload as {
      jsonrpc?: unknown;
      id?: unknown;
      result?: unknown;
      error?: unknown;
    };
    if (
      message.jsonrpc !== "2.0" ||
      message.id !== id ||
      message.error !== undefined ||
      message.result === undefined
    )
      throw new ToolRuntimeError("handler_error", "GitHub MCP JSON-RPC response was invalid.");
    return message.result as JsonValue;
  }
}
