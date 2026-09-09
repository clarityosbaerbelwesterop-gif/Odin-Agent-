import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { readBenchmarks } from "../dist/src/chat/benchmarks.js";
import { startChatServer } from "../dist/src/chat/http.js";
import { fixture, provider, response } from "../dist/test/chat/helpers.js";

// Separate local UI transport fixture. Never imported by the application or deployed function.
export async function startBrowserFixture(port = 0) {
  const workspace = await mkdtemp(join(tmpdir(), "odin-browser-workspace-"));
  const delayed = new Set();
  let built = false;
  let researched = false;
  const model = provider(async (input, call, options) => {
    const text =
      input.messages
        .filter((message) => message.role === "user")
        .at(-1)
        ?.content.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(" ") ?? "";
    if (text.includes("slow") && !delayed.has(text)) {
      delayed.add(text);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, 15000);
        options?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            reject(new Error("Fixture interrupted"));
          },
          { once: true },
        );
      });
    }
    const available = (name) => input.tools?.some((tool) => tool.name === name);
    if (available("repo_patch") && text.includes("interactive") && !built) {
      built = true;
      return response("Browser fixture: create the test page.", [
        {
          id: `plan-${call}`,
          name: "task_plan",
          arguments: {
            steps: [
              { title: "Create interactive page", status: "active" },
              { title: "Check syntax and preview", status: "pending" },
            ],
          },
        },
        {
          id: `html-${call}`,
          name: "repo_patch",
          arguments: {
            path: "index.html",
            expectedSha: "absent",
            content:
              '<!doctype html><html lang="en"><head><title>Browser fixture</title></head><body><h1>Interactive fixture</h1><button id="counter">Count: 0</button><script src="app.js"></script></body></html>',
          },
        },
        {
          id: `js-${call}`,
          name: "repo_patch",
          arguments: {
            path: "app.js",
            expectedSha: "absent",
            content:
              'let count=0;document.getElementById("counter").onclick=function(){this.textContent="Count: "+(++count);};',
          },
        },
      ]);
    }
    if (available("research_search") && text.includes("research") && !researched) {
      researched = true;
      return response("Browser research transport fixture.", [
        { id: `source-${call}`, name: "research_search", arguments: { query: "Odin" } },
      ]);
    }
    if (text.includes("research")) return response("Browser fixture finding [S1].");
    return response(`Browser fixture response. ${text.slice(0, 400)}`);
  });
  const f = await fixture(model, {
    workspaceRoot: workspace,
    allowWorkspaceWrites: true,
    quality: {
      commands: () => [{ id: "fixture-syntax", label: "Actual JavaScript syntax check" }],
      run: async (_command, signal) => {
        signal.throwIfAborted();
        try {
          parse(await readFile(join(workspace, "app.js"), "utf8"), { ecmaVersion: "latest" });
          return {
            exitCode: 0,
            output: "JavaScript parsed. Browser behavior is checked separately.",
          };
        } catch {
          return { exitCode: 1, output: "Syntax unavailable or invalid." };
        }
      },
    },
    research: {
      name: "Deterministic browser source fixture",
      search: async () => [
        {
          id: "fixture",
          title: "Odin source fixture",
          url: "https://en.wikipedia.org/wiki/Odin",
          excerpt: "Synthetic excerpt for citation rendering; not a live retrieval.",
          retrievedAt: new Date().toISOString(),
        },
      ],
    },
  });
  const token = randomBytes(32).toString("base64url");
  const app = await startChatServer({
    engine: f.engine,
    accessToken: token,
    port: 0,
    webRoot: join(process.cwd(), "web"),
    benchmark: await readBenchmarks(join(process.cwd(), "docs/evals")),
  });
  const login = await fetch(`${app.origin}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Odin-Request": "1", Origin: app.origin },
    body: JSON.stringify({ token }),
  });
  if (!login.ok) throw new Error("Fixture session initialization failed");
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const proxy = createServer((incoming, outgoing) => {
    // Trust is confined to this disposable loopback fixture, never a real user session.
    const target = new URL(app.origin);
    const upstream = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: incoming.url,
        method: incoming.method,
        headers: { ...incoming.headers, host: target.host, origin: app.origin, cookie },
      },
      (result) => {
        outgoing.writeHead(result.statusCode ?? 500, result.headers);
        result.pipe(outgoing);
      },
    );
    upstream.on("error", () => {
      outgoing.statusCode = 502;
      outgoing.end("Fixture proxy unavailable");
    });
    incoming.pipe(upstream);
    outgoing.on("close", () => upstream.destroy());
  });
  await new Promise((resolve) => proxy.listen(port, "127.0.0.1", resolve));
  const stop = async () => {
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
    await app.close();
    await f.close();
    await rm(workspace, { recursive: true, force: true });
  };
  return { origin: `http://127.0.0.1:${proxy.address().port}`, close: stop };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.ODIN_BROWSER_FIXTURE !== "1")
    throw new Error("Explicit browser fixture opt-in required");
  const app = await startBrowserFixture(4321);
  process.stdout.write(`Browser fixture: ${app.origin} (synthetic provider and session)\n`);
  process.once("SIGTERM", () => {
    void app.close();
  });
  process.once("SIGINT", () => {
    void app.close();
  });
}
