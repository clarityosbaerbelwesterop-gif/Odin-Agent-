import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function client() {
  const dom = new JSDOM(await readFile("web/chat.html", "utf8"), {
    url: "https://odin.example/app?project=11111111-1111-4111-8111-111111111111",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.confirm = () => true;
  const calls = [];
  window.fetch = async (path, options = {}) => {
    const url = String(path);
    calls.push({ url, options });
    if (url.includes("/retention"))
      return response({
        plan: {
          candidates: [
            { id: "memory-old", kind: "episodic", version: 1, recordHash: "b".repeat(64) },
          ],
        },
      });
    if (url.includes("/records/memory-a/history"))
      return response({
        history: [
          {
            version: 1,
            action: "written",
            updatedAt: "2026-09-13T08:00:00.000Z",
            recordHash: "a".repeat(64),
            sourceReference: "odin://project/source",
          },
        ],
      });
    if (url.includes("/signals/memory-a")) return response({ updated: true });
    if (/\/api\/memory\/projects\/[\w-]+(?:\?|$)/u.test(url))
      return response({
        projectId: "11111111-1111-4111-8111-111111111111",
        evaluatedAt: "2026-09-13T08:00:00.000Z",
        counts: {
          ACTIVE: 1,
          TEMPORARY: 0,
          STALE: 0,
          CONFLICTED: 1,
          SUPERSEDED: 0,
          NOISE_CANDIDATE: 1,
          ARCHIVED: 0,
        },
        nodes: [
          {
            id: "project:11111111-1111-4111-8111-111111111111",
            nodeClass: "PROJECT",
            title: "Odin",
          },
          {
            id: "memory-a",
            nodeClass: "MEMORY",
            title: "mobile-first",
            status: "ACTIVE",
            memoryKind: "project",
            summary: "The product is mobile first.",
            importance: 88,
            sensitivity: "internal",
            sourceClass: "explicit_user",
            sourceReference: "odin://project/source",
            sourceVersion: "1",
            sourceObservedAt: "2026-09-13T07:00:00.000Z",
            updatedAt: "2026-09-13T07:00:00.000Z",
            version: 1,
            usageCount: 2,
            pinned: true,
            activeInContext: true,
          },
          {
            id: "source-a",
            nodeClass: "DOCUMENT",
            title: "Product decisions",
            activeInContext: true,
          },
        ],
        edges: [
          {
            id: "contains-a",
            from: "project:11111111-1111-4111-8111-111111111111",
            to: "memory-a",
            relation: "contains",
          },
          {
            id: "source-edge-a",
            from: "memory-a",
            to: "source-a",
            relation: "sourced_from",
          },
        ],
        pulse: {
          turnId: "turn-a",
          selectedMemoryIds: ["memory-a"],
          selectedWorkspaceReferences: ["odin://project/source"],
          contextResultHash: "c".repeat(64),
          at: "2026-09-13T08:00:00.000Z",
          dropped: [],
        },
        truncated: false,
        projectionHash: "d".repeat(64),
        advanced: { conflicts: [], stale: [], resultHash: "e".repeat(64) },
      });
    return response({ message: "Unexpected request" }, 500);
  };
  window.eval(await readFile("web/memory-brain.js", "utf8"));
  return { window, calls, close: () => window.close() };
}

test("PRODUCT M3 renders only server-projected graph nodes and real Brain Pulse state", async () => {
  const app = await client();
  try {
    app.window.document.getElementById("knowledge-view").click();
    await tick();
    await tick();
    const nodes = app.window.document.querySelectorAll("#m3-nodes .m3-node");
    assert.equal(nodes.length, 3);
    assert.match(app.window.document.getElementById("m3-pulse-label").textContent, /2 selected/u);
    assert.equal(
      app.window.document.querySelectorAll("#m3-nodes .in-context").length,
      2,
    );
    assert.equal(app.window.document.getElementById("m3-conflicts").textContent, "1");
    assert.equal(app.window.document.getElementById("m3-noise").textContent, "1");
  } finally {
    app.close();
  }
});

test("PRODUCT M3 node selection exposes provenance metadata and revision history", async () => {
  const app = await client();
  try {
    app.window.document.getElementById("knowledge-view").click();
    await tick();
    await tick();
    app.window.document.querySelector('[data-node-id="memory-a"]').dispatchEvent(
      new app.window.MouseEvent("click", { bubbles: true }),
    );
    await tick();
    assert.equal(app.window.document.getElementById("m3-node-title").textContent, "mobile-first");
    assert.match(app.window.document.getElementById("m3-node-meta").textContent, /explicit_user/u);
    assert.match(app.window.document.getElementById("m3-history").textContent, /v1/u);
    assert.ok(app.calls.some((call) => call.url.includes("/records/memory-a/history")));
  } finally {
    app.close();
  }
});

test("PRODUCT M3 search/filter reloads bounded server projection instead of inventing nodes", async () => {
  const app = await client();
  try {
    app.window.document.getElementById("knowledge-view").click();
    await tick();
    await tick();
    const search = app.window.document.getElementById("m3-search");
    search.value = "mobile";
    search.dispatchEvent(new app.window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 240));
    assert.ok(app.calls.some((call) => call.url.includes("q=mobile")));
    const kind = app.window.document.getElementById("m3-kind");
    kind.value = "project";
    kind.dispatchEvent(new app.window.Event("change", { bubbles: true }));
    await tick();
    assert.ok(app.calls.some((call) => call.url.includes("kind=project")));
  } finally {
    app.close();
  }
});

test("PRODUCT M3 responsive graph keeps touch controls and iPad-focused inspector behavior", async () => {
  const css = await readFile("web/product-m3.css", "utf8");
  assert.match(css, /touch-action:none/u);
  assert.match(css, /@media\(max-width:820px\)/u);
  assert.match(css, /env\(safe-area-inset-bottom\)/u);
  assert.match(css, /max-height:58vh/u);
});

test("PRODUCT M3 server wiring fails closed for RLS, archived/stale/noise context and secret-like writes", async () => {
  const [migration, context, api] = await Promise.all([
    readFile("migrations/013_product_m3_memory_brain.sql", "utf8"),
    readFile("src/chat/workspace-context.ts", "utf8"),
    readFile("src/chat/memory-api.ts", "utf8"),
  ]);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/u);
  assert.match(migration, /owner_id=\(SELECT odin_api\.actor\(\)\)/u);
  assert.match(context, /s\.archived_at IS NULL/u);
  assert.match(context, /m\.expires_at IS NULL OR m\.expires_at>now\(\)/u);
  assert.match(context, /m\.kind='episodic'.*30 days/su);
  assert.match(context, /current_source\.sha<>m\.source_content_hash/u);
  assert.match(context, /peer\.source_content_hash<>m\.source_content_hash/u);
  assert.match(api, /containsObviousSecret/u);
  assert.match(api, /SECRET_MEMORY_DENIED/u);
  assert.doesNotMatch(api, /memory\.brain\.pulse.*POST/su);
});
