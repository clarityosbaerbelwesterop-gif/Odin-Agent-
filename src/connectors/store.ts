import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ActorDatabase } from "../chat/neon-database.js";
import { CredentialVault } from "../chat/product.js";
import type {
  ConnectorAuthMode,
  ConnectorConnection,
  ConnectorRuntime,
  ConnectorTokenSet,
  ConnectorToolCacheEntry,
} from "./types.js";
import { ConnectorError } from "./types.js";

interface OAuthTransaction {
  readonly connectionId: string;
  readonly connectorId: string;
  readonly endpoint: string;
  readonly resource: string;
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly verifier: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
}

function iso(value: unknown): string | null {
  if (!value) return null;
  return new Date(String(value)).toISOString();
}

function scopes(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mapConnection(row: Record<string, unknown>): ConnectorConnection {
  return Object.freeze({
    id: String(row.id),
    connectorId: String(row.connector_id),
    endpoint: row.endpoint ? String(row.endpoint) : null,
    runtime: row.runtime as ConnectorRuntime,
    authMode: row.auth_mode as ConnectorAuthMode,
    status: row.status as ConnectorConnection["status"],
    scopes: scopes(row.scopes),
    issuer: row.issuer ? String(row.issuer) : null,
    tokenExpiresAt: iso(row.token_expires_at),
    lastVerifiedAt: iso(row.last_verified_at),
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    createdAt: iso(row.created_at) as string,
    updatedAt: iso(row.updated_at) as string,
  });
}

export class ConnectorStore {
  constructor(
    readonly db: ActorDatabase,
    readonly vault: CredentialVault,
  ) {}

  async connections(): Promise<readonly ConnectorConnection[]> {
    return this.db.transaction(async (client) =>
      (
        await client.query(
          `SELECT id,connector_id,endpoint,runtime,auth_mode,status,scopes,issuer,
                  token_expires_at,last_verified_at,last_error_code,created_at,updated_at
           FROM odin_api.connector_connections ORDER BY updated_at DESC`,
        )
      ).rows.map((row) => mapConnection(row as Record<string, unknown>)),
    );
  }

  async connection(id: string): Promise<ConnectorConnection> {
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          `SELECT id,connector_id,endpoint,runtime,auth_mode,status,scopes,issuer,
                  token_expires_at,last_verified_at,last_error_code,created_at,updated_at
           FROM odin_api.connector_connections WHERE id=$1`,
          [id],
        )
      ).rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new ConnectorError("CONNECTION_NOT_FOUND", "Connector connection not found.", 404);
      return mapConnection(row);
    });
  }

  async createConnection(input: {
    connectorId: string;
    endpoint: string | null;
    runtime: ConnectorRuntime;
    authMode: ConnectorAuthMode;
    vercelConnectorUid?: string | undefined;
  }): Promise<ConnectorConnection> {
    const id = randomUUID();
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          `INSERT INTO odin_api.connector_connections(
             id,connector_id,endpoint,runtime,auth_mode,status,vercel_connector_uid
           ) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            id,
            input.connectorId,
            input.endpoint,
            input.runtime,
            input.authMode,
            input.authMode === "none" ? "connected" : "needs_authorization",
            input.vercelConnectorUid ?? null,
          ],
        )
      ).rows[0] as Record<string, unknown>;
      return mapConnection(row);
    });
  }

  async deleteConnection(id: string): Promise<void> {
    await this.db.transaction(async (client) => {
      const result = await client.query("DELETE FROM odin_api.connector_connections WHERE id=$1", [id]);
      if (!result.rowCount)
        throw new ConnectorError("CONNECTION_NOT_FOUND", "Connector connection not found.", 404);
    });
  }

  async markError(id: string, code: string): Promise<void> {
    const safe = /^[A-Z0-9_]{1,80}$/u.test(code) ? code : "CONNECTOR_ERROR";
    await this.db.transaction(async (client) => {
      await client.query(
        "UPDATE odin_api.connector_connections SET status='error',last_error_code=$2,updated_at=now() WHERE id=$1",
        [id, safe],
      );
    });
  }

  async createOAuthTransaction(input: {
    connectionId: string;
    connectorId: string;
    endpoint: string;
    resource: string;
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    clientId: string;
    clientSecret?: string | undefined;
    verifier: string;
    redirectUri: string;
    scopes: readonly string[];
  }): Promise<{ readonly state: string; readonly expiresAt: string }> {
    const state = randomBytes(32).toString("base64url");
    const stateHash = createHash("sha256").update(state).digest("hex");
    const verifier = this.vault.seal(input.verifier).ciphertext;
    const clientSecret = input.clientSecret ? this.vault.seal(input.clientSecret).ciphertext : null;
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await this.db.transaction(async (client) => {
      await client.query(
        "DELETE FROM odin_api.connector_oauth_transactions WHERE expires_at<now() OR consumed_at IS NOT NULL",
      );
      await client.query(
        `INSERT INTO odin_api.connector_oauth_transactions(
          state_hash,connection_id,connector_id,endpoint,resource,issuer,authorization_endpoint,
          token_endpoint,client_id,client_secret_ciphertext,verifier_ciphertext,redirect_uri,scopes,expires_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          stateHash,
          input.connectionId,
          input.connectorId,
          input.endpoint,
          input.resource,
          input.issuer,
          input.authorizationEndpoint,
          input.tokenEndpoint,
          input.clientId,
          clientSecret,
          verifier,
          input.redirectUri,
          [...input.scopes],
          expiresAt,
        ],
      );
    });
    return Object.freeze({ state, expiresAt });
  }

  async consumeOAuthTransaction(state: string): Promise<OAuthTransaction> {
    if (!/^[A-Za-z0-9_-]{32,200}$/u.test(state))
      throw new ConnectorError("OAUTH_STATE_INVALID", "Connector authorization state is invalid.", 403);
    const hash = createHash("sha256").update(state).digest("hex");
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          `UPDATE odin_api.connector_oauth_transactions SET consumed_at=now()
           WHERE state_hash=$1 AND consumed_at IS NULL AND expires_at>now()
           RETURNING *`,
          [hash],
        )
      ).rows[0] as Record<string, unknown> | undefined;
      if (!row)
        throw new ConnectorError(
          "OAUTH_STATE_INVALID",
          "Connector authorization expired or was already used.",
          403,
        );
      return Object.freeze({
        connectionId: String(row.connection_id),
        connectorId: String(row.connector_id),
        endpoint: String(row.endpoint),
        resource: String(row.resource),
        issuer: String(row.issuer),
        authorizationEndpoint: String(row.authorization_endpoint),
        tokenEndpoint: String(row.token_endpoint),
        clientId: String(row.client_id),
        ...(row.client_secret_ciphertext
          ? { clientSecret: this.vault.open(String(row.client_secret_ciphertext)) }
          : {}),
        verifier: this.vault.open(String(row.verifier_ciphertext)),
        redirectUri: String(row.redirect_uri),
        scopes: scopes(row.scopes),
      });
    });
  }

  async saveTokenSet(
    id: string,
    token: ConnectorTokenSet,
    metadata: { readonly issuer: string; readonly resource: string; readonly clientId: string },
  ): Promise<ConnectorConnection> {
    const access = this.vault.seal(token.accessToken).ciphertext;
    const refresh = token.refreshToken ? this.vault.seal(token.refreshToken).ciphertext : null;
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          `UPDATE odin_api.connector_connections SET
             status='connected',access_token_ciphertext=$2,refresh_token_ciphertext=$3,token_type=$4,
             token_expires_at=$5,scopes=$6,issuer=$7,resource=$8,client_id=$9,
             last_verified_at=now(),last_error_code=NULL,updated_at=now()
           WHERE id=$1 RETURNING *`,
          [
            id,
            access,
            refresh,
            token.tokenType,
            token.expiresAt ?? null,
            [...token.scopes],
            metadata.issuer,
            metadata.resource,
            metadata.clientId,
          ],
        )
      ).rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new ConnectorError("CONNECTION_NOT_FOUND", "Connector connection not found.", 404);
      return mapConnection(row);
    });
  }

  async saveApiKey(id: string, value: string): Promise<ConnectorConnection> {
    const sealed = this.vault.seal(value).ciphertext;
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          `UPDATE odin_api.connector_connections SET status='connected',access_token_ciphertext=$2,
           token_type='Bearer',last_verified_at=now(),last_error_code=NULL,updated_at=now()
           WHERE id=$1 RETURNING *`,
          [id, sealed],
        )
      ).rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new ConnectorError("CONNECTION_NOT_FOUND", "Connector connection not found.", 404);
      return mapConnection(row);
    });
  }

  async credential(id: string): Promise<{
    readonly accessToken: string;
    readonly refreshToken?: string;
    readonly tokenType: string;
    readonly expiresAt: string | null;
    readonly issuer: string | null;
    readonly resource: string | null;
    readonly clientId: string | null;
    readonly clientSecret?: string;
  }> {
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          `SELECT access_token_ciphertext,refresh_token_ciphertext,token_type,token_expires_at,
                  issuer,resource,client_id,client_secret_ciphertext
           FROM odin_api.connector_connections WHERE id=$1 AND status='connected'`,
          [id],
        )
      ).rows[0] as Record<string, unknown> | undefined;
      if (!row?.access_token_ciphertext)
        throw new ConnectorError("AUTH_REQUIRED", "Connector authorization is required.", 401);
      return Object.freeze({
        accessToken: this.vault.open(String(row.access_token_ciphertext)),
        ...(row.refresh_token_ciphertext
          ? { refreshToken: this.vault.open(String(row.refresh_token_ciphertext)) }
          : {}),
        tokenType: row.token_type ? String(row.token_type) : "Bearer",
        expiresAt: iso(row.token_expires_at),
        issuer: row.issuer ? String(row.issuer) : null,
        resource: row.resource ? String(row.resource) : null,
        clientId: row.client_id ? String(row.client_id) : null,
        ...(row.client_secret_ciphertext
          ? { clientSecret: this.vault.open(String(row.client_secret_ciphertext)) }
          : {}),
      });
    });
  }

  async cacheTools(connectionId: string, tools: readonly ConnectorToolCacheEntry[]): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query("DELETE FROM odin_api.connector_tool_cache WHERE connection_id=$1", [connectionId]);
      for (const tool of tools) {
        await client.query(
          `INSERT INTO odin_api.connector_tool_cache(
            connection_id,remote_name,tool_name,title,operation,risk_class,side_effecting,
            requires_approval,input_schema,observed_at,expires_at
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            connectionId,
            tool.remoteName,
            tool.toolName,
            tool.title,
            tool.operation,
            tool.riskClass,
            tool.sideEffecting,
            tool.requiresApproval,
            tool.inputSchema,
            tool.observedAt,
            tool.expiresAt,
          ],
        );
      }
    });
  }

  async cachedTools(connectionId: string): Promise<readonly ConnectorToolCacheEntry[]> {
    return this.db.transaction(async (client) =>
      (
        await client.query(
          `SELECT remote_name,tool_name,title,operation,risk_class,side_effecting,requires_approval,
                  input_schema,observed_at,expires_at
           FROM odin_api.connector_tool_cache WHERE connection_id=$1 AND expires_at>now()
           ORDER BY tool_name`,
          [connectionId],
        )
      ).rows.map((row) => ({
        remoteName: String(row.remote_name),
        toolName: String(row.tool_name),
        title: String(row.title),
        operation: row.operation,
        riskClass: row.risk_class,
        sideEffecting: row.side_effecting === true,
        requiresApproval: row.requires_approval === true,
        inputSchema: row.input_schema as Record<string, unknown>,
        observedAt: new Date(row.observed_at).toISOString(),
        expiresAt: new Date(row.expires_at).toISOString(),
      })),
    );
  }
}
