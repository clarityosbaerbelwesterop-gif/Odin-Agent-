import type { ToolOperation, ToolRiskClass } from "../tools/types.js";

export type ConnectorAuthMode = "oauth" | "api_key" | "none";
export type ConnectorTransport = "mcp" | "api";
export type ConnectorRuntime = "direct_mcp" | "vercel_connect" | "custom_mcp";
export type ConnectorCategory =
  | "ai"
  | "analytics"
  | "commerce"
  | "communication"
  | "content"
  | "data"
  | "developer"
  | "productivity"
  | "other";
export type ConnectorStatus = "connected" | "disconnected" | "needs_authorization" | "error";

export interface ConnectorPolicy {
  readonly defaultRisk: ToolRiskClass;
  readonly readPrefixes: readonly string[];
  readonly searchPrefixes: readonly string[];
  readonly writePrefixes: readonly string[];
  readonly alwaysApprovalPrefixes: readonly string[];
  readonly metered: boolean;
}

export interface ConnectorDescriptor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: ConnectorCategory;
  readonly runtime: ConnectorRuntime;
  readonly transports: readonly ConnectorTransport[];
  readonly authModes: readonly ConnectorAuthMode[];
  readonly officialMcpUrl?: string;
  readonly vercelService?: string;
  readonly sourceUrl: string;
  readonly firstClass: boolean;
  readonly policy: ConnectorPolicy;
}

export interface ConnectorConnection {
  readonly id: string;
  readonly connectorId: string;
  readonly endpoint: string | null;
  readonly runtime: ConnectorRuntime;
  readonly authMode: ConnectorAuthMode;
  readonly status: ConnectorStatus;
  readonly scopes: readonly string[];
  readonly issuer: string | null;
  readonly tokenExpiresAt: string | null;
  readonly lastVerifiedAt: string | null;
  readonly lastErrorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConnectorOAuthDiscovery {
  readonly resource: string;
  readonly authorizationServer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly registrationEndpoint: string | null;
  readonly scopesSupported: readonly string[];
  readonly clientIdMetadataDocumentSupported: boolean;
}

export interface ConnectorAuthorizationStart {
  readonly authorizationUrl: string;
  readonly expiresAt: string;
}

export interface ConnectorTokenSet {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenType: string;
  readonly expiresAt?: string;
  readonly scopes: readonly string[];
}

export interface RemoteMcpTool {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface ConnectorToolSummary {
  readonly remoteName: string;
  readonly toolName: string;
  readonly title: string;
  readonly operation: ToolOperation;
  readonly riskClass: ToolRiskClass;
  readonly sideEffecting: boolean;
  readonly requiresApproval: boolean;
}

export interface ConnectorToolCacheEntry extends ConnectorToolSummary {
  readonly inputSchema: Record<string, unknown>;
  readonly observedAt: string;
  readonly expiresAt: string;
}

export class ConnectorError extends Error {
  constructor(
    readonly code:
      | "AUTH_REQUIRED"
      | "AUTH_DISCOVERY_FAILED"
      | "AUTH_RESPONSE_INVALID"
      | "CATALOG_NOT_FOUND"
      | "CONNECTION_NOT_FOUND"
      | "ENDPOINT_DENIED"
      | "INVALID_INPUT"
      | "MCP_PROTOCOL_ERROR"
      | "MCP_RESPONSE_TOO_LARGE"
      | "MCP_TOOL_DENIED"
      | "OAUTH_STATE_INVALID"
      | "PROVIDER_NOT_CONFIGURED"
      | "TOKEN_REFRESH_FAILED",
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
