import { connectorDescriptor, CONNECTOR_CATALOG, classifyRemoteTool } from "./catalog.js";
import { RemoteMcpClient } from "./mcp-client.js";
import { authorizeConnectorUrl } from "./network.js";
import {
  buildAuthorizationStart,
  connectorClientMetadata,
  createPkce,
  discoverMcpOAuth,
  exchangeAuthorizationCode,
  refreshOAuthToken,
  registerOAuthClient,
} from "./oauth.js";
import { ConnectorStore } from "./store.js";
import type {
  ConnectorAuthorizationStart,
  ConnectorConnection,
  ConnectorDescriptor,
  ConnectorToolCacheEntry,
} from "./types.js";
import { ConnectorError } from "./types.js";

function envPrefix(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]+/gu, "_");
}

function configuredClient(
  id: string,
  env: NodeJS.ProcessEnv,
): { readonly clientId?: string; readonly clientSecret?: string } {
  const prefix = envPrefix(id);
  const clientId = env[`ODIN_CONNECTOR_${prefix}_CLIENT_ID`];
  const clientSecret = env[`ODIN_CONNECTOR_${prefix}_CLIENT_SECRET`];
  return Object.freeze({
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
  });
}

function cleanScopes(
  requested: readonly string[],
  supported: readonly string[],
): readonly string[] {
  if (requested.length > 40)
    throw new ConnectorError("INVALID_INPUT", "Too many connector scopes were requested.");
  const unique = [...new Set(requested.map((scope) => scope.trim()).filter(Boolean))];
  if (unique.some((scope) => scope.length > 300 || /[\u0000-\u0020]/u.test(scope)))
    throw new ConnectorError("INVALID_INPUT", "Connector scope is invalid.");
  if (supported.length && unique.some((scope) => !supported.includes(scope)))
    throw new ConnectorError("INVALID_INPUT", "A requested scope is not advertised by this connector.");
  return Object.freeze(unique);
}

function publicDescriptor(descriptor: ConnectorDescriptor): ConnectorDescriptor {
  return Object.freeze(structuredClone(descriptor));
}

export class ConnectorService {
  constructor(
    readonly store: ConnectorStore,
    readonly env: NodeJS.ProcessEnv = process.env,
    readonly transport: typeof fetch = fetch,
  ) {}

  async catalog(): Promise<{
    readonly connectors: readonly (ConnectorDescriptor & {
      readonly connections: readonly ConnectorConnection[];
    })[];
  }> {
    const connections = await this.store.connections();
    return Object.freeze({
      connectors: Object.freeze(
        CONNECTOR_CATALOG.map((descriptor) =>
          Object.freeze({
            ...publicDescriptor(descriptor),
            connections: Object.freeze(
              connections.filter((connection) => connection.connectorId === descriptor.id),
            ),
          }),
        ),
      ),
    });
  }

  clientMetadata(origin: string): Record<string, unknown> {
    return connectorClientMetadata(origin);
  }

  async startOAuth(input: {
    readonly connectorId: string;
    readonly origin: string;
    readonly endpoint?: string | undefined;
    readonly scopes?: readonly string[] | undefined;
  }): Promise<{
    readonly connection: ConnectorConnection;
    readonly authorization: ConnectorAuthorizationStart;
  }> {
    const descriptor = connectorDescriptor(input.connectorId);
    if (!descriptor.authModes.includes("oauth"))
      throw new ConnectorError("INVALID_INPUT", "This connector does not support OAuth.");
    if (descriptor.runtime === "vercel_connect")
      throw new ConnectorError(
        "PROVIDER_NOT_CONFIGURED",
        "Link a Vercel Connect connector UID for this catalog provider.",
        409,
      );
    const rawEndpoint = descriptor.officialMcpUrl ?? input.endpoint;
    if (!rawEndpoint)
      throw new ConnectorError("INVALID_INPUT", "A remote MCP endpoint is required.");
    const endpoint = (await authorizeConnectorUrl(rawEndpoint)).href;
    const discovery = await discoverMcpOAuth(endpoint, this.transport);
    const client = await registerOAuthClient(
      discovery,
      input.origin,
      configuredClient(descriptor.id, this.env),
      this.transport,
    );
    const { verifier, challenge } = createPkce();
    const redirectUri = `${new URL(input.origin).origin}/api/connectors/oauth/callback`;
    const selectedScopes = cleanScopes(input.scopes ?? [], discovery.scopesSupported);
    const connection = await this.store.createConnection({
      connectorId: descriptor.id,
      endpoint,
      runtime: descriptor.runtime,
      authMode: "oauth",
    });
    try {
      const transaction = await this.store.createOAuthTransaction({
        connectionId: connection.id,
        connectorId: descriptor.id,
        endpoint,
        resource: discovery.resource,
        issuer: discovery.authorizationServer,
        authorizationEndpoint: discovery.authorizationEndpoint,
        tokenEndpoint: discovery.tokenEndpoint,
        clientId: client.clientId,
        ...(client.clientSecret ? { clientSecret: client.clientSecret } : {}),
        verifier,
        redirectUri,
        scopes: selectedScopes,
      });
      return Object.freeze({
        connection,
        authorization: buildAuthorizationStart(
          {
            discovery,
            client,
            verifier,
            scopes: selectedScopes,
            redirectUri,
            resource: discovery.resource,
          },
          transaction.state,
          challenge,
          transaction.expiresAt,
        ),
      });
    } catch (error) {
      await this.store.deleteConnection(connection.id).catch(() => {});
      throw error;
    }
  }

  async finishOAuth(input: {
    readonly state: string;
    readonly code: string;
    readonly issuer?: string | undefined;
  }): Promise<ConnectorConnection> {
    const transaction = await this.store.consumeOAuthTransaction(input.state);
    if (input.issuer) {
      let callbackIssuer: string;
      try {
        callbackIssuer = new URL(input.issuer).href.replace(/\/$/u, "");
      } catch {
        throw new ConnectorError("AUTH_RESPONSE_INVALID", "OAuth callback issuer is invalid.", 403);
      }
      if (callbackIssuer !== transaction.issuer.replace(/\/$/u, ""))
        throw new ConnectorError("AUTH_RESPONSE_INVALID", "OAuth callback issuer did not match discovery.", 403);
    }
    try {
      const token = await exchangeAuthorizationCode(
        {
          code: input.code,
          clientId: transaction.clientId,
          ...(transaction.clientSecret ? { clientSecret: transaction.clientSecret } : {}),
          verifier: transaction.verifier,
          redirectUri: transaction.redirectUri,
          tokenEndpoint: transaction.tokenEndpoint,
          resource: transaction.resource,
          scopes: transaction.scopes,
        },
        this.transport,
      );
      const connection = await this.store.saveTokenSet(transaction.connectionId, token, {
        issuer: transaction.issuer,
        resource: transaction.resource,
        clientId: transaction.clientId,
      });
      await this.refreshTools(connection.id, true);
      return this.store.connection(connection.id);
    } catch (error) {
      await this.store.markError(
        transaction.connectionId,
        error instanceof ConnectorError ? error.code : "CONNECTOR_ERROR",
      );
      throw error;
    }
  }

  async connectApiKey(input: {
    readonly connectorId: string;
    readonly endpoint?: string | undefined;
    readonly apiKey: string;
  }): Promise<ConnectorConnection> {
    const descriptor = connectorDescriptor(input.connectorId);
    if (!descriptor.authModes.includes("api_key"))
      throw new ConnectorError("INVALID_INPUT", "This connector does not accept an API key.");
    if (!input.apiKey || input.apiKey.length > 64_000 || /[\r\n]/u.test(input.apiKey))
      throw new ConnectorError("INVALID_INPUT", "Connector credential is invalid.");
    if (descriptor.runtime === "vercel_connect")
      throw new ConnectorError(
        "PROVIDER_NOT_CONFIGURED",
        "API keys for brokered connectors belong in Vercel Connect, not Odin storage.",
        409,
      );
    const rawEndpoint = descriptor.officialMcpUrl ?? input.endpoint;
    if (!rawEndpoint) throw new ConnectorError("INVALID_INPUT", "A remote MCP endpoint is required.");
    const endpoint = (await authorizeConnectorUrl(rawEndpoint)).href;
    const connection = await this.store.createConnection({
      connectorId: descriptor.id,
      endpoint,
      runtime: descriptor.runtime,
      authMode: "api_key",
    });
    try {
      const saved = await this.store.saveApiKey(connection.id, input.apiKey);
      await this.refreshTools(saved.id, true);
      return this.store.connection(saved.id);
    } catch (error) {
      await this.store.deleteConnection(connection.id).catch(() => {});
      throw error;
    }
  }

  async refreshTools(
    connectionId: string,
    force = false,
  ): Promise<readonly ConnectorToolCacheEntry[]> {
    if (!force) {
      const cached = await this.store.cachedTools(connectionId);
      if (cached.length) return cached;
    }
    const connection = await this.store.connection(connectionId);
    const descriptor = connectorDescriptor(connection.connectorId);
    if (connection.runtime === "vercel_connect")
      throw new ConnectorError(
        "PROVIDER_NOT_CONFIGURED",
        "This Vercel Connect entry is catalog-only until a project-linked connector is configured.",
        409,
      );
    if (!connection.endpoint)
      throw new ConnectorError("CONNECTION_NOT_FOUND", "Connector endpoint is missing.", 409);
    const credential = await this.#freshCredential(connection);
    const client = new RemoteMcpClient(connection.endpoint, credential.accessToken, this.transport);
    const remote = await client.listTools();
    const now = new Date();
    const expires = new Date(now.getTime() + 15 * 60_000).toISOString();
    const entries = remote.map((tool) => {
      const classification = classifyRemoteTool(descriptor, tool);
      return Object.freeze({
        ...classification,
        inputSchema: structuredClone(tool.inputSchema),
        observedAt: now.toISOString(),
        expiresAt: expires,
      });
    });
    const unique = new Map<string, ConnectorToolCacheEntry>();
    for (const entry of entries) {
      if (unique.has(entry.toolName))
        throw new ConnectorError("MCP_TOOL_DENIED", "Remote MCP exposed colliding tool names.", 502);
      unique.set(entry.toolName, entry);
    }
    const tools = Object.freeze([...unique.values()]);
    await this.store.cacheTools(connectionId, tools);
    return tools;
  }

  async callRemoteTool(
    connectionId: string,
    remoteName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const connection = await this.store.connection(connectionId);
    const tools = await this.refreshTools(connectionId);
    const allowed = tools.find((tool) => tool.remoteName === remoteName);
    if (!allowed)
      throw new ConnectorError("MCP_TOOL_DENIED", "MCP tool was not discovered for this connection.", 403);
    if (!connection.endpoint)
      throw new ConnectorError("CONNECTION_NOT_FOUND", "Connector endpoint is missing.", 409);
    const credential = await this.#freshCredential(connection);
    return new RemoteMcpClient(connection.endpoint, credential.accessToken, this.transport).callTool(
      remoteName,
      args,
      signal,
    );
  }

  async #freshCredential(connection: ConnectorConnection) {
    const credential = await this.store.credential(connection.id);
    if (
      connection.authMode !== "oauth" ||
      !credential.expiresAt ||
      Date.parse(credential.expiresAt) > Date.now() + 90_000
    )
      return credential;
    if (!credential.refreshToken || !credential.clientId || !credential.resource || !connection.endpoint)
      throw new ConnectorError("AUTH_REQUIRED", "Connector authorization must be renewed.", 401);
    const discovery = await discoverMcpOAuth(connection.endpoint, this.transport);
    if (credential.issuer && discovery.authorizationServer !== credential.issuer)
      throw new ConnectorError("TOKEN_REFRESH_FAILED", "OAuth issuer changed since authorization.", 502);
    const refreshed = await refreshOAuthToken(
      {
        refreshToken: credential.refreshToken,
        clientId: credential.clientId,
        ...(credential.clientSecret ? { clientSecret: credential.clientSecret } : {}),
        tokenEndpoint: discovery.tokenEndpoint,
        resource: credential.resource,
        scopes: connection.scopes,
      },
      this.transport,
    );
    await this.store.saveTokenSet(connection.id, refreshed, {
      issuer: discovery.authorizationServer,
      resource: credential.resource,
      clientId: credential.clientId,
    });
    return this.store.credential(connection.id);
  }
}
