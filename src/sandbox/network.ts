import { createHash } from "node:crypto";
import { isIP } from "node:net";
import {
  type OutboundNetworkDecision,
  type OutboundNetworkPolicyOptions,
  SandboxError,
} from "./types.js";

const MAX_DNS_ADDRESSES = 32;

export class OutboundNetworkPolicy {
  readonly #allowedHosts: readonly string[];
  readonly #allowedPorts: ReadonlySet<number>;
  readonly #allowHttp: boolean;
  readonly #resolver: OutboundNetworkPolicyOptions["resolver"];

  constructor(options: OutboundNetworkPolicyOptions) {
    if (options.allowedHosts.length === 0) {
      throw new SandboxError("DESTINATION_INVALID", "Outbound host allowlist must not be empty.");
    }
    this.#allowedHosts = Object.freeze(options.allowedHosts.map(normalizeAllowedHost).sort());
    if (new Set(this.#allowedHosts).size !== this.#allowedHosts.length) {
      throw new SandboxError("DESTINATION_INVALID", "Outbound host allowlist contains duplicates.");
    }
    const allowedPorts = options.allowedPorts ?? [443];
    if (
      allowedPorts.length === 0 ||
      allowedPorts.some((port) => !Number.isSafeInteger(port) || port < 1 || port > 65_535)
    ) {
      throw new SandboxError("DESTINATION_INVALID", "Outbound port allowlist is invalid.");
    }
    this.#allowedPorts = new Set(allowedPorts);
    this.#allowHttp = options.allowHttp === true;
    this.#resolver = options.resolver;
  }

  async authorize(rawUrl: string): Promise<OutboundNetworkDecision> {
    if (typeof rawUrl !== "string" || rawUrl.trim() === "" || hasControlCharacter(rawUrl)) {
      throw new SandboxError("DESTINATION_INVALID", "Outbound URL is malformed.");
    }

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new SandboxError("DESTINATION_INVALID", "Outbound URL is malformed.");
    }
    if (url.username !== "" || url.password !== "" || url.hash !== "") {
      throw new SandboxError(
        "DESTINATION_INVALID",
        "Outbound URL credentials and fragments are not allowed.",
      );
    }
    if (url.protocol !== "https:" && !(this.#allowHttp && url.protocol === "http:")) {
      throw new SandboxError("NETWORK_DENIED", "Outbound protocol is not allowed.");
    }

    const hostname = normalizeHostname(url.hostname);
    if (!this.#allowedHosts.some((allowed) => hostMatches(hostname, allowed))) {
      throw new SandboxError("NETWORK_DENIED", "Outbound hostname is not in the scoped allowlist.");
    }
    const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
    if (!this.#allowedPorts.has(port)) {
      throw new SandboxError("NETWORK_DENIED", "Outbound port is not in the scoped allowlist.");
    }

    const literalVersion = isIP(hostname);
    const resolved =
      literalVersion === 0 ? await this.#resolvePublic(hostname) : Object.freeze([hostname]);
    for (const address of resolved) assertPublicAddress(address);
    const addresses = Object.freeze([...new Set(resolved)].sort());
    if (addresses.length === 0 || addresses.length > MAX_DNS_ADDRESSES) {
      throw new SandboxError("NETWORK_DENIED", "Outbound DNS result count is outside its bound.");
    }

    url.hostname = hostname;
    const normalizedUrl = url.toString();
    const resolutionHash = createHash("sha256")
      .update(JSON.stringify({ addresses, hostname, normalizedUrl, port }))
      .digest("hex");
    return Object.freeze({ addresses, hostname, normalizedUrl, port, resolutionHash });
  }

  async #resolvePublic(hostname: string): Promise<readonly string[]> {
    let addresses: readonly string[];
    try {
      addresses = await this.#resolver.resolve(hostname);
    } catch {
      throw new SandboxError("NETWORK_DENIED", "Outbound DNS resolution failed.");
    }
    if (!Array.isArray(addresses) || addresses.length === 0 || addresses.length > MAX_DNS_ADDRESSES) {
      throw new SandboxError("NETWORK_DENIED", "Outbound DNS result count is outside its bound.");
    }
    return Object.freeze([...addresses]);
  }
}

function normalizeAllowedHost(value: string): string {
  if (typeof value !== "string" || value.trim() === "" || hasControlCharacter(value)) {
    throw new SandboxError("DESTINATION_INVALID", "Outbound host allowlist entry is malformed.");
  }
  const lowered = value.toLowerCase();
  const wildcard = lowered.startsWith("*.");
  const host = wildcard ? lowered.slice(2) : lowered;
  if (!isHostnameSyntax(host) && isIP(host) === 0) {
    throw new SandboxError("DESTINATION_INVALID", "Outbound host allowlist entry is malformed.");
  }
  return wildcard ? `*.${host}` : host;
}

function normalizeHostname(value: string): string {
  const unwrapped = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  const hostname = unwrapped.toLowerCase();
  if (hostname.includes("%") || (!isHostnameSyntax(hostname) && isIP(hostname) === 0)) {
    throw new SandboxError("DESTINATION_INVALID", "Outbound hostname is malformed.");
  }
  return hostname;
}

function hostMatches(hostname: string, allowed: string): boolean {
  if (!allowed.startsWith("*.")) return hostname === allowed;
  const suffix = allowed.slice(1);
  return hostname.endsWith(suffix) && hostname.length > suffix.length;
}

function isHostnameSyntax(value: string): boolean {
  if (value.length > 253 || value.endsWith(".")) return false;
  const labels = value.split(".");
  return labels.every(
    (label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label) && label.length <= 63,
  );
}

function assertPublicAddress(address: string): void {
  const version = isIP(address);
  if (version === 4) {
    const bytes = parseIpv4(address);
    if (bytes === null || !isPublicIpv4(bytes)) {
      throw new SandboxError("NETWORK_DENIED", "Outbound address is private or reserved.");
    }
    return;
  }
  if (version === 6) {
    const bytes = parseIpv6(address);
    if (bytes === null || !isPublicIpv6(bytes)) {
      throw new SandboxError("NETWORK_DENIED", "Outbound address is private or reserved.");
    }
    return;
  }
  throw new SandboxError("NETWORK_DENIED", "Outbound DNS returned a non-IP address.");
}

function isPublicIpv4(bytes: readonly number[]): boolean {
  const [a = 0, b = 0] = bytes;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0) return false;
  if (a >= 224) return false;
  return true;
}

function isPublicIpv6(bytes: readonly number[]): boolean {
  if (bytes.every((byte) => byte === 0)) return false;
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return false;
  if ((bytes[0] ?? 0) >= 0xfc && (bytes[0] ?? 0) <= 0xfd) return false;
  if (bytes[0] === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80) return false;
  if (bytes[0] === 0xff) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return false;
  }
  if (
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  ) {
    return isPublicIpv4(bytes.slice(12));
  }
  return true;
}

function parseIpv4(value: string): readonly number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return numbers;
}

function parseIpv6(value: string): readonly number[] | null {
  if (value.includes("%") || value.split("::").length > 2) return null;
  const [leftRaw = "", rightRaw = ""] = value.toLowerCase().split("::");
  const left = ipv6Hextets(leftRaw);
  const right = ipv6Hextets(rightRaw);
  if (left === null || right === null) return null;
  const hasCompression = value.includes("::");
  const missing = 8 - left.length - right.length;
  if ((hasCompression && missing < 1) || (!hasCompression && missing !== 0)) return null;
  const hextets = [...left, ...Array.from({ length: Math.max(0, missing) }, () => 0), ...right];
  if (hextets.length !== 8) return null;
  const bytes: number[] = [];
  for (const hextet of hextets) bytes.push((hextet >> 8) & 0xff, hextet & 0xff);
  return bytes;
}

function ipv6Hextets(value: string): number[] | null {
  if (value === "") return [];
  const parts = value.split(":");
  const output: number[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? "";
    if (part.includes(".")) {
      if (index !== parts.length - 1) return null;
      const ipv4 = parseIpv4(part);
      if (ipv4 === null) return null;
      output.push(((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0));
      output.push(((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0));
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/u.test(part)) return null;
    output.push(Number.parseInt(part, 16));
  }
  return output;
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value);
}
