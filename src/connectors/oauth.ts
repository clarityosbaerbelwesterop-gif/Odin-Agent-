import { createHash, randomBytes } from "node:crypto";
import { boundedJson, safeConnectorFetch } from "./network.js";
import type {
  ConnectorAuthorizationStart,
  ConnectorOAuthDiscovery,
  ConnectorTokenSet,
} from "./types.js";
import { ConnectorError } from "./types.js";

const MCP_PROTOCOL_VERSION = "2026-07-28";
const MAX_SCOPE_COUNT = 80;

interface ProtectedResourceMetadata {
  readonly resource: string;
  readonly authorizationServers: readonly string[];
  readonly scopesSupported: readonly string[];
}

export interface OAuthClientRegistration {
  readonly clientId: string;
  readonly clientSecret?: string;
}

export interface OAuthStartContext {
  readonly discovery: ConnectorOAuthDiscovery;
  readonly client: OAuthClientRegistration;
  readonly verifier: string;
  readonly scopes: readonly string[];
  readonly redirectUri: string;
  readonly resource: string;
}

function strings(value: unknown, max = MAX_SCOPE_COUNT): readonly string[] {
  if (!Array.isArray(value)) return [];
  return Object.freeze(
    value
      .filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 300)
      .slice(0, max),
  );
}

function httpsUrl(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 2000)
    throw new ConnectorError("AUTH_RESPONSE_INVALID", `${label} is missing from OAuth metadata.`, 502);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConnectorError("AUTH_RESPONSE_INVALID", `${label} is not a valid URL.`, 502);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new ConnectorError("AUTH_RESPONSE_INVALID", `${label} must be a public HTTPS URL.`, 502);
  return url.href.replace(/\/$/u, "");
}

function wellKnown(resource: URL): readonly string[] {
  const suffix = resource.pathname === "/" ? "" : resource.pathname.replace(/^\//u, "/");
  return Object.freeze([
    `${resource.origin}/.well-known/oauth-protected-resource${suffix}`,
    `${resource.origin}/.well-known/oauth-protected-resource`,
  ]);
}

function metadataFromWwwAuthenticate(value: string | null): string | null {
  if (!value) return null;
  const match = /(?:^|[,\s])resource_metadata=(?:"([^"]+)"|([^,\s]+))/iu.exec(value);
  return match?.[1] ?? match?.[2] ?? null;
}

async function readProtectedResourceMetadata(
  endpoint: string,
  transport: typeof fetch,
): Promise<ProtectedResourceMetadata> {
  const resource = new URL(endpoint);
  const candidates: string[] = [];
  try {
    const probe = await safeConnectorFetch(
      endpoint,
      {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "odin-oauth-discovery",
          method: "tools/list",
          params: {},
        }),
      },
      transport,
    );
    const advertised = metadataFromWwwAuthenticate(probe.headers.get("www-authenticate"));
    if (advertised) candidates.push(advertised);
  } catch {
    // Well-known discovery below remains authoritative and avoids making OAuth dependent on probe shape.
  }
  candidates.push(...wellKnown(resource));

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    let response: Response;
    try {
      response = await safeConnectorFetch(candidate, { headers: { Accept: "application/json" } }, transport);
    } catch {
      continue;
    }
    if (!response.ok) continue;
    const body = await boundedJson(response);
    const declared = body.resource === undefined ? endpoint : httpsUrl(body.resource, "resource");
    if (new URL(declared).origin !== resource.origin)
      throw new ConnectorError(
        "AUTH_RESPONSE_INVALID",
        "Protected resource metadata points at a different resource origin.",
        502,
      );
    const authorizationServers = strings(body.authorization_servers).map((item) =>
      httpsUrl(item, "authorization server"),
    );
    if (!authorizationServers.length)
      throw new ConnectorError(
        "AUTH_RESPONSE_INVALID",
        "Protected resource metadata did not advertise an authorization server.",
        502,
      );
    return Object.freeze({
      resource: declared,
      authorizationServers,
      scopesSupported: strings(body.scopes_supported),
    });
  }

  throw new ConnectorError(
    "AUTH_DISCOVERY_FAILED",
    "The MCP server did not expose OAuth protected-resource metadata.",
    502,
  );
}

function authorizationWellKnown(issuer: URL): readonly string[] {
  const path = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/u, "");
  return Object.freeze([
    `${issuer.origin}/.well-known/oauth-authorization-server${path}`,
    `${issuer.origin}/.well-known/openid-configuration${path}`,
  ]);
}

async function readAuthorizationServer(
  issuerValue: string,
  resourceScopes: readonly string[],
  transport: typeof fetch,
): Promise<ConnectorOAuthDiscovery> {
  const expectedIssuer = new URL(issuerValue);
  for (const candidate of authorizationWellKnown(expectedIssuer)) {
    let response: Response;
    try {
      response = await safeConnectorFetch(candidate, { headers: { Accept: "application/json" } }, transport);
    } catch {
      continue;
    }
    if (!response.ok) continue;
    const body = await boundedJson(response);
    const issuer = httpsUrl(body.issuer, "issuer");
    if (issuer !== expectedIssuer.href.replace(/\/$/u, ""))
      throw new ConnectorError("AUTH_RESPONSE_INVALID", "OAuth issuer metadata did not match discovery.", 502);
    const methods = strings(body.code_challenge_methods_supported);
    if (methods.length && !methods.includes("S256"))
      throw new ConnectorError("AUTH_RESPONSE_INVALID", "OAuth server does not support PKCE S256.", 502);
    const asScopes = strings(body.scopes_supported);
    const supported = resourceScopes.length
      ? resourceScopes.filter((scope) => !asScopes.length || asScopes.includes(scope))
      : asScopes;
    return Object.freeze({
      resource: "",
      authorizationServer: issuer,
      authorizationEndpoint: httpsUrl(body.authorization_endpoint, "authorization endpoint"),
      tokenEndpoint: httpsUrl(body.token_endpoint, "token endpoint"),
      registrationEndpoint:
        body.registration_endpoint === undefined
          ? null
          : httpsUrl(body.registration_endpoint, "registration endpoint"),
      scopesSupported: Object.freeze([...supported]),
      clientIdMetadataDocumentSupported: body.client_id_metadata_document_supported === true,
    });
  }
  throw new ConnectorError(
    "AUTH_DISCOVERY_FAILED",
    "The MCP authorization server did not expose OAuth metadata.",
    502,
  );
}

export async function discoverMcpOAuth(
  endpoint: string,
  transport: typeof fetch = fetch,
): Promise<ConnectorOAuthDiscovery> {
  const resource = await readProtectedResourceMetadata(endpoint, transport);
  const discovery = await readAuthorizationServer(
    resource.authorizationServers[0] as string,
    resource.scopesSupported,
    transport,
  );
  return Object.freeze({ ...discovery, resource: resource.resource });
}

export function createPkce(): { readonly verifier: string; readonly challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return Object.freeze({ verifier, challenge });
}

export function connectorClientMetadata(origin: string): Record<string, unknown> {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.pathname !== "/" || base.username || base.password)
    throw new ConnectorError("INVALID_INPUT", "Odin public origin must be an HTTPS origin.", 500);
  const clientId = `${base.origin}/api/connectors/oauth/client-metadata`;
  return Object.freeze({
    client_id: clientId,
    client_name: "Odin Agent",
    client_uri: base.origin,
    redirect_uris: [`${base.origin}/api/connectors/oauth/callback`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
}

export async function registerOAuthClient(
  discovery: ConnectorOAuthDiscovery,
  origin: string,
  configured: { readonly clientId?: string; readonly clientSecret?: string } = {},
  transport: typeof fetch = fetch,
): Promise<OAuthClientRegistration> {
  if (configured.clientId) {
    return Object.freeze({
      clientId: configured.clientId,
      ...(configured.clientSecret ? { clientSecret: configured.clientSecret } : {}),
    });
  }
  const metadata = connectorClientMetadata(origin);
  if (discovery.clientIdMetadataDocumentSupported) {
    return Object.freeze({ clientId: String(metadata.client_id) });
  }
  if (!discovery.registrationEndpoint)
    throw new ConnectorError(
      "PROVIDER_NOT_CONFIGURED",
      "This OAuth server requires a pre-registered client and did not offer MCP client registration.",
      503,
    );
  const response = await safeConnectorFetch(
    discovery.registrationEndpoint,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    },
    transport,
  );
  if (!response.ok)
    throw new ConnectorError("AUTH_RESPONSE_INVALID", "OAuth dynamic client registration failed.", 502);
  const body = await boundedJson(response);
  if (typeof body.client_id !== "string" || body.client_id.length > 2000)
    throw new ConnectorError("AUTH_RESPONSE_INVALID", "OAuth registration did not return a client id.", 502);
  return Object.freeze({
    clientId: body.client_id,
    ...(typeof body.client_secret === "string" && body.client_secret.length <= 16_000
      ? { clientSecret: body.client_secret }
      : {}),
  });
}

export function buildAuthorizationStart(
  context: OAuthStartContext,
  state: string,
  challenge: string,
  expiresAt: string,
): ConnectorAuthorizationStart {
  const url = new URL(context.discovery.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", context.client.clientId);
  url.searchParams.set("redirect_uri", context.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", context.resource);
  if (context.scopes.length) url.searchParams.set("scope", context.scopes.join(" "));
  return Object.freeze({ authorizationUrl: url.href, expiresAt });
}

function tokenSet(body: Record<string, unknown>, fallbackScopes: readonly string[]): ConnectorTokenSet {
  if (typeof body.access_token !== "string" || !body.access_token.trim() || body.access_token.length > 64_000)
    throw new ConnectorError("AUTH_RESPONSE_INVALID", "OAuth token response did not contain an access token.", 502);
  const tokenType = typeof body.token_type === "string" ? body.token_type : "Bearer";
  const expiresIn = Number(body.expires_in);
  const expiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0 && expiresIn <= 31_536_000
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : undefined;
  const returnedScopes =
    typeof body.scope === "string"
      ? body.scope.split(/\s+/u).filter(Boolean).slice(0, MAX_SCOPE_COUNT)
      : [...fallbackScopes];
  return Object.freeze({
    accessToken: body.access_token,
    ...(typeof body.refresh_token === "string" && body.refresh_token.length <= 64_000
      ? { refreshToken: body.refresh_token }
      : {}),
    tokenType,
    ...(expiresAt ? { expiresAt } : {}),
    scopes: Object.freeze(returnedScopes),
  });
}

export async function exchangeAuthorizationCode(
  input: {
    readonly code: string;
    readonly clientId: string;
    readonly clientSecret?: string;
    readonly verifier: string;
    readonly redirectUri: string;
    readonly tokenEndpoint: string;
    readonly resource: string;
    readonly scopes: readonly string[];
  },
  transport: typeof fetch = fetch,
): Promise<ConnectorTokenSet> {
  if (!input.code || input.code.length > 16_000)
    throw new ConnectorError("AUTH_RESPONSE_INVALID", "OAuth authorization code is invalid.");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    client_id: input.clientId,
    code_verifier: input.verifier,
    redirect_uri: input.redirectUri,
    resource: input.resource,
  });
  if (input.clientSecret) body.set("client_secret", input.clientSecret);
  const response = await safeConnectorFetch(
    input.tokenEndpoint,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    transport,
  );
  if (!response.ok)
    throw new ConnectorError("AUTH_RESPONSE_INVALID", "OAuth code exchange failed.", 502);
  return tokenSet(await boundedJson(response), input.scopes);
}

export async function refreshOAuthToken(
  input: {
    readonly refreshToken: string;
    readonly clientId: string;
    readonly clientSecret?: string;
    readonly tokenEndpoint: string;
    readonly resource: string;
    readonly scopes: readonly string[];
  },
  transport: typeof fetch = fetch,
): Promise<ConnectorTokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    resource: input.resource,
  });
  if (input.clientSecret) body.set("client_secret", input.clientSecret);
  if (input.scopes.length) body.set("scope", input.scopes.join(" "));
  const response = await safeConnectorFetch(
    input.tokenEndpoint,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    transport,
  );
  if (!response.ok) throw new ConnectorError("TOKEN_REFRESH_FAILED", "OAuth token refresh failed.", 502);
  return tokenSet(await boundedJson(response), input.scopes);
}
