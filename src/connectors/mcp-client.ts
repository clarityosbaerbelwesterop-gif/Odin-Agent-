import type { JsonValue } from "../providers/types.js";
import { safeConnectorFetch } from "./network.js";
import type { RemoteMcpTool } from "./types.js";
import { ConnectorError } from "./types.js";

const CURRENT_PROTOCOL = "2026-07-28";
const LEGACY_PROTOCOL = "2025-11-25";
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_TOOLS = 500;
const MAX_PAGES = 10;

interface JsonRpcResponse {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ConnectorError("MCP_PROTOCOL_ERROR", "MCP returned an invalid object.", 502);
  return value as Record<string, unknown>;
}

function validTool(value: unknown): RemoteMcpTool | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.name !== "string" ||
    item.name.length < 1 ||
    item.name.length > 200 ||
    !item.inputSchema ||
    typeof item.inputSchema !== "object" ||
    Array.isArray(item.inputSchema)
  )
    return null;
  const encoded = JSON.stringify(item.inputSchema);
  if (encoded.length > 200_000) return null;
  return Object.freeze({
    name: item.name,
    ...(typeof item.title === "string" && item.title.length <= 500 ? { title: item.title } : {}),
    ...(typeof item.description === "string" && item.description.length <= 4000
      ? { description: item.description }
      : {}),
    inputSchema: structuredClone(item.inputSchema as Record<string, unknown>),
  });
}

function parseEventStream(text: string, expectedId: number): JsonRpcResponse {
  for (const block of text.split(/\r?\n\r?\n/u)) {
    const data = block
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data) continue;
    try {
      const value = JSON.parse(data) as JsonRpcResponse;
      if (value.id === expectedId) return value;
    } catch {
      continue;
    }
  }
  throw new ConnectorError("MCP_PROTOCOL_ERROR", "MCP event stream did not contain the expected response.", 502);
}

async function readRpcResponse(response: Response, expectedId: number): Promise<JsonRpcResponse> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES)
    throw new ConnectorError("MCP_RESPONSE_TOO_LARGE", "MCP response exceeded Odin's size limit.", 502);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES)
    throw new ConnectorError("MCP_RESPONSE_TOO_LARGE", "MCP response exceeded Odin's size limit.", 502);
  const text = new TextDecoder().decode(bytes);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/event-stream")) return parseEventStream(text, expectedId);
  try {
    return JSON.parse(text) as JsonRpcResponse;
  } catch {
    throw new ConnectorError("MCP_PROTOCOL_ERROR", "MCP returned malformed JSON-RPC.", 502);
  }
}

export class RemoteMcpClient {
  #id = 0;
  #legacyInitialized = false;
  #sessionId: string | undefined;
  #protocol = CURRENT_PROTOCOL;

  constructor(
    readonly endpoint: string,
    readonly accessToken: string,
    readonly transport: typeof fetch = fetch,
  ) {
    if (!accessToken || accessToken.length > 64_000 || /[\r\n]/u.test(accessToken))
      throw new ConnectorError("AUTH_REQUIRED", "Connector access token is invalid.", 401);
  }

  async listTools(signal?: AbortSignal): Promise<readonly RemoteMcpTool[]> {
    try {
      return await this.#listPages(signal);
    } catch (error) {
      if (!(error instanceof ConnectorError) || error.code !== "MCP_PROTOCOL_ERROR") throw error;
      await this.#initializeLegacy(signal);
      return this.#listPages(signal);
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    if (!name || name.length > 200 || /[\u0000\r\n]/u.test(name))
      throw new ConnectorError("MCP_TOOL_DENIED", "MCP tool name is invalid.");
    if (JSON.stringify(args).length > 256_000)
      throw new ConnectorError("INVALID_INPUT", "MCP tool arguments are too large.");
    let result: unknown;
    try {
      result = await this.#request("tools/call", { name, arguments: args }, signal);
    } catch (error) {
      if (!(error instanceof ConnectorError) || error.code !== "MCP_PROTOCOL_ERROR") throw error;
      await this.#initializeLegacy(signal);
      result = await this.#request("tools/call", { name, arguments: args }, signal);
    }
    return structuredClone(result) as JsonValue;
  }

  async #listPages(signal?: AbortSignal): Promise<readonly RemoteMcpTool[]> {
    const result: RemoteMcpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = object(
        await this.#request("tools/list", cursor ? { cursor } : {}, signal),
      );
      if (!Array.isArray(response.tools))
        throw new ConnectorError("MCP_PROTOCOL_ERROR", "MCP tools/list result was invalid.", 502);
      for (const candidate of response.tools) {
        const tool = validTool(candidate);
        if (!tool) continue;
        if (result.some((existing) => existing.name === tool.name)) continue;
        result.push(tool);
        if (result.length >= MAX_TOOLS) return Object.freeze(result);
      }
      if (typeof response.nextCursor !== "string" || !response.nextCursor) break;
      cursor = response.nextCursor;
    }
    return Object.freeze(result);
  }

  async #initializeLegacy(signal?: AbortSignal): Promise<void> {
    if (this.#legacyInitialized) return;
    this.#protocol = LEGACY_PROTOCOL;
    const result = object(
      await this.#request(
        "initialize",
        {
          protocolVersion: LEGACY_PROTOCOL,
          capabilities: {},
          clientInfo: { name: "odin-agent", version: "1" },
        },
        signal,
        true,
      ),
    );
    if (typeof result.protocolVersion !== "string")
      throw new ConnectorError("MCP_PROTOCOL_ERROR", "Legacy MCP initialize response was invalid.", 502);
    await this.#notify("notifications/initialized", {}, signal);
    this.#legacyInitialized = true;
  }

  async #notify(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
    const headers: Record<string, string> = {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": this.#protocol,
    };
    if (this.#sessionId) headers["Mcp-Session-Id"] = this.#sessionId;
    const response = await safeConnectorFetch(
      this.endpoint,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", method, params }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      },
      this.transport,
    );
    if (response.status === 401 || response.status === 403)
      throw new ConnectorError("AUTH_REQUIRED", "MCP authorization is no longer valid.", 401);
    if (!response.ok && response.status !== 202 && response.status !== 204)
      throw new ConnectorError("MCP_PROTOCOL_ERROR", `MCP notification returned HTTP ${response.status}.`, 502);
  }

  async #request(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    initializing = false,
  ): Promise<unknown> {
    const id = ++this.#id;
    const headers: Record<string, string> = {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": this.#protocol,
      "Mcp-Method": method,
      "Mcp-Name": "odin-agent",
    };
    if (this.#sessionId) headers["Mcp-Session-Id"] = this.#sessionId;
    const response = await safeConnectorFetch(
      this.endpoint,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
      },
      this.transport,
    );
    if (response.status === 401 || response.status === 403)
      throw new ConnectorError("AUTH_REQUIRED", "MCP authorization is required.", 401);
    if (!response.ok)
      throw new ConnectorError("MCP_PROTOCOL_ERROR", `MCP returned HTTP ${response.status}.`, 502);
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId && sessionId.length <= 500 && !/[\r\n]/u.test(sessionId)) this.#sessionId = sessionId;
    const message = await readRpcResponse(response, id);
    if (message.jsonrpc !== "2.0" || message.id !== id || message.error !== undefined || message.result === undefined) {
      if (!initializing) throw new ConnectorError("MCP_PROTOCOL_ERROR", "MCP JSON-RPC response was invalid.", 502);
      throw new ConnectorError("MCP_PROTOCOL_ERROR", "MCP initialize request failed.", 502);
    }
    return message.result;
  }
}
