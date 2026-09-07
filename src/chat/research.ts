import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { OutboundNetworkPolicy } from "../sandbox/network.js";
import { safeText } from "./safety.js";
import { ChatError, type ChatSource, type ResearchAdapter } from "./types.js";

export type ResearchTransport = (url: string, signal: AbortSignal) => Promise<unknown>;

/** Public GET-only JSON transport pins the approved DNS address and refuses redirects. */
export function publicJsonTransport(hosts: readonly string[]): ResearchTransport {
  const policy = new OutboundNetworkPolicy({
    allowedHosts: hosts,
    resolver: {
      resolve: async (hostname) =>
        (await lookup(hostname, { all: true })).map((answer) => answer.address),
    },
  });
  return async (url, signal) => {
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
    const decision = await policy.authorize(url);
    timeout.throwIfAborted();
    return new Promise((resolve, reject) => {
      const req = request(
        decision.normalizedUrl,
        {
          hostname: decision.addresses[0],
          servername: decision.hostname,
          signal: timeout,
          method: "GET",
          headers: {
            Host: decision.hostname,
            Accept: "application/json",
            "User-Agent": "OdinAgent/0.1 (bounded research client)",
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(
              new ChatError("RESEARCH_UNAVAILABLE", "The research source is unavailable.", 502),
            );
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 1_000_000) {
              req.destroy(new Error("Response limit"));
              return;
            }
            chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
              reject(new ChatError("RESEARCH_FORMAT", "Research returned malformed data.", 502));
            }
          });
        },
      );
      req.on("error", () =>
        reject(new ChatError("RESEARCH_UNAVAILABLE", "Research request failed or timed out.", 502)),
      );
      req.end();
    });
  };
}

/** Encyclopedic search is explicit in the UI; it is not described as whole-web coverage. */
export class WikipediaResearchAdapter implements ResearchAdapter {
  readonly name = "Wikipedia · encyclopedic sources";
  readonly #host: string;
  readonly #transport: ResearchTransport;
  constructor(language: "en" | "de" = "en", transport?: ResearchTransport) {
    if (language !== "en" && language !== "de")
      throw new ChatError("RESEARCH_LANGUAGE", "Unsupported research language.");
    this.#host = `${language}.wikipedia.org`;
    this.#transport = transport ?? publicJsonTransport([this.#host]);
  }
  async search(query: string, signal: AbortSignal): Promise<readonly ChatSource[]> {
    safeText(query, 500);
    const url = new URL(`https://${this.#host}/w/api.php`);
    url.search = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: query,
      gsrlimit: "5",
      prop: "extracts|info",
      inprop: "url",
      exintro: "1",
      explaintext: "1",
      exlimit: "5",
      exchars: "4000",
      format: "json",
      formatversion: "2",
    }).toString();
    const raw = await this.#transport(url.toString(), signal);
    if (!record(raw) || "error" in raw)
      throw new ChatError("RESEARCH_FORMAT", "Research returned an invalid response.", 502);
    if (raw.query === undefined) return [];
    if (!record(raw.query) || !Array.isArray(raw.query.pages))
      throw new ChatError("RESEARCH_FORMAT", "Research pages are missing.", 502);
    return raw.query.pages.slice(0, 5).map((page, index) => {
      if (!record(page) || typeof page.fullurl !== "string")
        throw new ChatError("RESEARCH_FORMAT", "Invalid source URL.", 502);
      const sourceUrl = new URL(page.fullurl);
      if (
        sourceUrl.protocol !== "https:" ||
        sourceUrl.hostname !== this.#host ||
        sourceUrl.username ||
        sourceUrl.password
      )
        throw new ChatError(
          "RESEARCH_SCOPE",
          "Source escaped the configured research domain.",
          502,
        );
      return {
        id: `S${index + 1}`,
        title: safeText(page.title, 500),
        url: sourceUrl.toString(),
        excerpt: safeText(page.extract, 8000),
        retrievedAt: new Date().toISOString(),
      };
    });
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
