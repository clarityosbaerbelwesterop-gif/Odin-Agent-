import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { parse } from "parse5";
import { OutboundNetworkPolicy } from "../sandbox/network.js";
import { type BrowserOutcome, type BrowserPageEvidence, pageEvidence } from "./browser-mode.js";
import { ChatError } from "./types.js";

export interface BrowserHttpActionResult {
  readonly outcome: BrowserOutcome;
  readonly finalUrl: string;
  readonly status: number | null;
  readonly evidence: BrowserPageEvidence | null;
}

interface HttpResult {
  readonly status: number;
  readonly body: string;
  readonly location: string | null;
  readonly contentType: string;
}

interface HtmlNode {
  readonly nodeName?: string;
  readonly tagName?: string;
  readonly value?: string;
  readonly attrs?: readonly { readonly name: string; readonly value: string }[];
  readonly childNodes?: readonly HtmlNode[];
}

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;

/**
 * A deliberately small browser transport: public HTTPS navigation plus standard
 * form POST. It has no ambient cookies, credential store, filesystem access or
 * script execution. Every DNS resolution and redirect is re-authorized by the
 * canonical outbound network policy before bytes are sent.
 */
export class SecureBrowserHttpClient {
  async observe(
    rawUrl: string,
    allowedOrigins: readonly string[],
    signal: AbortSignal,
  ): Promise<BrowserPageEvidence> {
    let current = scopedUrl(rawUrl, allowedOrigins);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const result = await requestOnce("GET", current, allowedOrigins, signal);
      if (isRedirect(result.status) && result.location) {
        if (redirects === MAX_REDIRECTS)
          throw new ChatError("BROWSER_REDIRECT_LIMIT", "Browser redirect limit reached.", 502);
        current = scopedUrl(new URL(result.location, current).toString(), allowedOrigins);
        continue;
      }
      if (result.status < 200 || result.status >= 400)
        throw new ChatError(
          "BROWSER_PAGE_UNAVAILABLE",
          `Browser page returned HTTP ${result.status}.`,
          502,
        );
      if (!/^text\/(?:html|plain)(?:;|$)/iu.test(result.contentType))
        throw new ChatError(
          "BROWSER_CONTENT_TYPE",
          "Browser navigation supports bounded text/HTML pages only.",
          415,
        );
      return parseEvidence(current, result.status, result.body, result.contentType);
    }
    throw new ChatError("BROWSER_REDIRECT_LIMIT", "Browser redirect limit reached.", 502);
  }

  async submitForm(
    rawUrl: string,
    fields: Readonly<Record<string, string>>,
    allowedOrigins: readonly string[],
    signal: AbortSignal,
  ): Promise<BrowserHttpActionResult> {
    const target = scopedUrl(rawUrl, allowedOrigins);
    const body = new URLSearchParams(Object.entries(fields).slice(0, 100)).toString();
    if (Buffer.byteLength(body) > 64_000)
      throw new ChatError("BROWSER_FORM_LIMIT", "Prepared form data is too large.", 413);
    try {
      const result = await requestOnce("POST", target, allowedOrigins, signal, body);
      let finalUrl = target;
      if (isRedirect(result.status) && result.location)
        finalUrl = scopedUrl(new URL(result.location, target).toString(), allowedOrigins);
      const evidence = /^text\/(?:html|plain)(?:;|$)/iu.test(result.contentType)
        ? parseEvidence(finalUrl, result.status, result.body, result.contentType)
        : null;
      return Object.freeze({
        outcome: "EXECUTED" as const,
        finalUrl,
        status: result.status,
        evidence,
      });
    } catch (error) {
      if (error instanceof ChatError) throw error;
      return Object.freeze({
        outcome: "UNKNOWN" as const,
        finalUrl: target,
        status: null,
        evidence: null,
      });
    }
  }
}

async function requestOnce(
  method: "GET" | "POST",
  rawUrl: string,
  allowedOrigins: readonly string[],
  signal: AbortSignal,
  body = "",
): Promise<HttpResult> {
  const target = new URL(scopedUrl(rawUrl, allowedOrigins));
  const policy = new OutboundNetworkPolicy({
    allowedHosts: allowedOrigins.map((origin) => new URL(origin).hostname),
    resolver: {
      resolve: async (hostname) =>
        (await lookup(hostname, { all: true })).map((answer) => answer.address),
    },
  });
  const authorized = await policy.authorize(target.toString());
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  boundedSignal.throwIfAborted();
  return new Promise<HttpResult>((resolve, reject) => {
    const req = request(
      authorized.normalizedUrl,
      {
        method,
        hostname: authorized.addresses[0],
        servername: authorized.hostname,
        signal: boundedSignal,
        headers: {
          Host: authorized.hostname,
          Accept: "text/html,text/plain;q=0.9",
          "User-Agent": "OdinAgent/0.1 (controlled browser)",
          ...(method === "POST"
            ? {
                "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
                "Content-Length": String(Buffer.byteLength(body)),
              }
            : {}),
        },
      },
      (res) => {
        const status = res.statusCode ?? 502;
        const contentType = String(res.headers["content-type"] ?? "").toLowerCase();
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            req.destroy(
              new ChatError("BROWSER_RESPONSE_LIMIT", "Browser response exceeded 1 MB.", 413),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({ status, body: Buffer.concat(chunks).toString("utf8"), location, contentType }),
        );
      },
    );
    req.on("error", reject);
    if (method === "POST") req.write(body);
    req.end();
  });
}

function scopedUrl(rawUrl: string, allowedOrigins: readonly string[]): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ChatError("BROWSER_TARGET", "Browser destination is malformed.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !allowedOrigins.includes(url.origin.toLowerCase())
  )
    throw new ChatError(
      "BROWSER_REDIRECT_DENIED",
      "Browser destination escaped the approved origin scope.",
      403,
    );
  return url.toString();
}

function parseEvidence(
  url: string,
  status: number,
  body: string,
  contentType: string,
): BrowserPageEvidence {
  if (contentType.startsWith("text/plain")) return pageEvidence({ url, status, text: body });
  const document = parse(body) as unknown as HtmlNode;
  const text: string[] = [];
  const links: { text: string; url: string }[] = [];
  const forms: Array<{
    action: string;
    method: "GET" | "POST";
    fields: Array<{ name: string; type: string; required: boolean }>;
  }> = [];
  let title = "";

  const visit = (node: HtmlNode, suppressed = false): void => {
    const tag = node.tagName?.toLowerCase();
    const hidden = suppressed || tag === "script" || tag === "style" || tag === "noscript";
    if (!hidden && node.nodeName === "#text" && node.value?.trim()) text.push(node.value.trim());
    if (tag === "title" && node.childNodes) title = collectText(node).trim().slice(0, 500);
    if (tag === "a") {
      const href = attr(node, "href");
      if (href) {
        try {
          links.push({
            text: collectText(node).trim().slice(0, 500),
            url: new URL(href, url).toString(),
          });
        } catch {
          /* inert malformed page data */
        }
      }
    }
    if (tag === "form") {
      const rawAction = attr(node, "action") || url;
      let action = url;
      try {
        action = new URL(rawAction, url).toString();
      } catch {
        action = rawAction;
      }
      const method = attr(node, "method").toUpperCase() === "POST" ? "POST" : "GET";
      const fields: Array<{ name: string; type: string; required: boolean }> = [];
      const inputs = (candidate: HtmlNode): void => {
        if (["input", "textarea", "select"].includes(candidate.tagName?.toLowerCase() ?? "")) {
          const name = attr(candidate, "name");
          if (name)
            fields.push({
              name,
              type: attr(candidate, "type") || candidate.tagName || "text",
              required: hasAttr(candidate, "required"),
            });
        }
        for (const child of candidate.childNodes ?? []) inputs(child);
      };
      inputs(node);
      forms.push({ action, method, fields });
    }
    for (const child of node.childNodes ?? []) visit(child, hidden);
  };
  visit(document);
  return pageEvidence({ url, status, title, text: text.join(" "), links, forms });
}

function attr(node: HtmlNode, name: string): string {
  return node.attrs?.find((item) => item.name.toLowerCase() === name)?.value ?? "";
}
function hasAttr(node: HtmlNode, name: string): boolean {
  return node.attrs?.some((item) => item.name.toLowerCase() === name) ?? false;
}
function collectText(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value ?? "";
  return (node.childNodes ?? []).map(collectText).join(" ");
}
function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}
