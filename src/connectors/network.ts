import { resolve4, resolve6 } from "node:dns/promises";
import { OutboundNetworkPolicy } from "../sandbox/network.js";
import { ConnectorError } from "./types.js";

const resolver = {
  async resolve(hostname: string): Promise<readonly string[]> {
    const [ipv4, ipv6] = await Promise.all([
      resolve4(hostname).catch(() => []),
      resolve6(hostname).catch(() => []),
    ]);
    return [...ipv4, ...ipv6];
  },
};

export async function authorizeConnectorUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConnectorError("ENDPOINT_DENIED", "Connector URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.port !== ""
  ) {
    throw new ConnectorError(
      "ENDPOINT_DENIED",
      "Connector URLs must use public HTTPS on the standard port and cannot contain credentials or fragments.",
    );
  }
  try {
    const policy = new OutboundNetworkPolicy({
      allowedHosts: [url.hostname],
      allowedPorts: [443],
      allowHttp: false,
      resolver,
    });
    const decision = await policy.authorize(url.href);
    return new URL(decision.normalizedUrl);
  } catch {
    throw new ConnectorError("ENDPOINT_DENIED", "Connector destination is not a permitted public endpoint.");
  }
}

export async function safeConnectorFetch(
  raw: string,
  init: RequestInit = {},
  transport: typeof fetch = fetch,
): Promise<Response> {
  const url = await authorizeConnectorUrl(raw);
  try {
    return await transport(url, {
      ...init,
      redirect: "error",
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    throw new ConnectorError("AUTH_DISCOVERY_FAILED", "Connector network request failed.", 502);
  }
}

export async function boundedJson(
  response: Response,
  maxBytes = 512_000,
): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new ConnectorError("AUTH_RESPONSE_INVALID", "Connector response is too large.", 502);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes)
    throw new ConnectorError("AUTH_RESPONSE_INVALID", "Connector response is too large.", 502);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ConnectorError("AUTH_RESPONSE_INVALID", "Connector returned malformed JSON.", 502);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ConnectorError("AUTH_RESPONSE_INVALID", "Connector response must be a JSON object.", 502);
  return value as Record<string, unknown>;
}
