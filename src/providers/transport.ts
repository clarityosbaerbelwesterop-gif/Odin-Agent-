import { isIP } from "node:net";
import { isProviderError, ProviderError } from "./errors.js";

export interface HttpRequest {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs: number;
}

export interface HttpTransport {
  request(request: HttpRequest): Promise<Response>;
}

export class FetchHttpTransport implements HttpTransport {
  async request(request: HttpRequest): Promise<Response> {
    const timeoutSignal = AbortSignal.timeout(request.timeoutMs);
    const signal =
      request.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([request.signal, timeoutSignal]);

    return fetch(request.url, {
      body: request.body,
      cache: "no-store",
      credentials: "omit",
      headers: request.headers,
      method: request.method,
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
    });
  }
}

export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export async function executeHttpRequest(
  provider: string,
  transport: HttpTransport,
  request: HttpRequest,
): Promise<Response> {
  try {
    return await transport.request(request);
  } catch (error) {
    if (request.signal?.aborted === true) {
      throw new ProviderError({
        category: "aborted",
        cause: error,
        message: "The provider request was aborted.",
        provider,
        retryable: false,
      });
    }

    if (isNamedError(error, "TimeoutError")) {
      throw new ProviderError({
        category: "timeout",
        cause: error,
        message: "The provider request timed out.",
        provider,
        retryable: true,
      });
    }

    throw new ProviderError({
      category: "network",
      cause: error,
      message: "The provider request failed before a response was received.",
      provider,
      retryable: true,
    });
  }
}

export async function readJsonResponse(
  provider: string,
  response: Response,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
): Promise<unknown> {
  const text = await readLimitedBody(provider, response, maxBytes);
  if (!response.ok) throwHttpError(provider, response, text);

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ProviderError({
      category: "malformed_response",
      cause: error,
      message: "The provider returned invalid JSON.",
      provider,
      requestId: requestIdFrom(response.headers),
      retryable: false,
      status: response.status,
    });
  }
}

export async function ensureStreamingResponse(
  provider: string,
  response: Response,
): Promise<ReadableStream<Uint8Array>> {
  if (!response.ok) {
    const text = await readLimitedBody(provider, response, DEFAULT_MAX_RESPONSE_BYTES);
    throwHttpError(provider, response, text);
  }
  if (response.body === null) {
    throw new ProviderError({
      category: "malformed_response",
      message: "The provider returned an empty streaming body.",
      provider,
      requestId: requestIdFrom(response.headers),
      retryable: false,
      status: response.status,
    });
  }
  return response.body;
}

export async function readLimitedBody(
  provider: string,
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel("response size limit exceeded").catch(() => undefined);
        throw new ProviderError({
          category: "malformed_response",
          message: `The provider response exceeded the ${maxBytes}-byte safety limit.`,
          provider,
          requestId: requestIdFrom(response.headers),
          retryable: false,
          status: response.status,
        });
      }
      chunks.push(value);
    }
  } catch (error) {
    if (isProviderError(error)) throw error;
    throw new ProviderError({
      category: isNamedError(error, "TimeoutError") ? "timeout" : "network",
      cause: error,
      message: "The provider response body could not be read.",
      provider,
      requestId: requestIdFrom(response.headers),
      retryable: true,
      status: response.status,
    });
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export function requestIdFrom(headers: Headers): string | undefined {
  return (
    headers.get("x-request-id") ??
    headers.get("request-id") ??
    headers.get("x-generation-id") ??
    undefined
  );
}

export function validatedBaseUrl(
  value: string,
  allowInsecureHttp = false,
  allowPrivateNetwork = false,
): URL {
  const url = new URL(value);
  if (url.username !== "" || url.password !== "") {
    throw new TypeError("Provider base URLs must not contain credentials.");
  }
  if (url.protocol !== "https:" && !(allowInsecureHttp && url.protocol === "http:")) {
    throw new TypeError("Provider base URLs must use HTTPS.");
  }
  if (!allowPrivateNetwork && isObviouslyPrivateHost(url.hostname)) {
    throw new TypeError("Provider base URLs must not target a private network by default.");
  }
  url.search = "";
  url.hash = "";
  return url;
}

function isObviouslyPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;

  if (isIP(host) === 6) {
    if (host === "::" || host === "::1" || host.startsWith("ff")) return true;
    const firstHextet = Number.parseInt(host.split(":", 1)[0] ?? "", 16);
    if ((firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80) return true;
    const mappedIpv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host)?.[1];
    return mappedIpv4 === undefined ? false : isObviouslyPrivateHost(mappedIpv4);
  }

  const octets = host.split(".").map(Number);
  if (isIP(host) !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false;
  const [first = -1, second = -1] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

export function endpointUrl(baseUrl: URL, endpoint: string): string {
  const path = `${baseUrl.pathname.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;
  return new URL(path, baseUrl.origin).toString();
}

function throwHttpError(provider: string, response: Response, text: string): never {
  const payload = parseObject(text);
  const errorObject = isObject(payload.error) ? payload.error : payload;
  const code = stringValue(errorObject.code) ?? stringValue(errorObject.type);
  const message = safeProviderMessage(errorObject.message);
  const status = response.status;
  const category = categoryFor(status, code);

  throw new ProviderError({
    category,
    code,
    message: message ?? defaultMessage(category),
    provider,
    requestId: requestIdFrom(response.headers),
    retryable: isRetryable(category, status),
    retryAfterMs: retryAfterMs(response.headers),
    status,
  });
}

function categoryFor(status: number, code: string | undefined) {
  const normalized = code?.toLowerCase() ?? "";
  if (
    status === 413 ||
    ["context_length_exceeded", "context_window_exceeded", "prompt_too_long"].includes(normalized)
  ) {
    return "context_overflow" as const;
  }
  if (["insufficient_quota", "quota_exceeded", "credit_balance_too_low"].includes(normalized)) {
    return "quota" as const;
  }
  if (status === 401) return "authentication" as const;
  if (status === 403) return "permission" as const;
  if (status === 408) return "timeout" as const;
  if (status === 429) return "rate_limit" as const;
  if (status >= 500) return "unavailable" as const;
  if (status >= 400) return "invalid_request" as const;
  return "unknown" as const;
}

function isRetryable(category: string, status: number): boolean {
  return (
    category === "rate_limit" ||
    category === "timeout" ||
    category === "unavailable" ||
    status === 409
  );
}

function retryAfterMs(headers: Headers): number | undefined {
  const milliseconds = headers.get("retry-after-ms");
  if (milliseconds !== null) {
    const parsed = Number(milliseconds);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
  }

  const retryAfter = headers.get("retry-after");
  if (retryAfter === null) return undefined;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const date = Date.parse(retryAfter);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function safeProviderMessage(value: unknown): string | undefined {
  const message = stringValue(value);
  return message === undefined ? undefined : message.slice(0, 500);
}

function defaultMessage(category: string): string {
  return `The provider returned a ${category.replaceAll("_", " ")} error.`;
}

function isNamedError(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}
