import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { until } from "../dist/test/chat/helpers.js";
import { startBrowserFixture } from "./chathub-browser-fixture.mjs";

async function client({ unavailable = false, mode = "" } = {}) {
  const app = await startBrowserFixture();
  const dom = new JSDOM(await readFile("web/chat.html", "utf8"), {
    url: `${app.origin}/app?mode=${encodeURIComponent(mode)}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const window = dom.window;
  const streams = new Set();
  const lifetime = new AbortController();
  // DOM-level tests do not assert native dialog layout, browser CSP enforcement or rendering.
  if (!window.HTMLDialogElement.prototype.showModal)
    window.HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
  if (!window.HTMLDialogElement.prototype.close)
    window.HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  window.fetch = (path, options) =>
    unavailable && path === "/api/config"
      ? Promise.resolve(
          new Response(JSON.stringify({ message: "Test backend unavailable" }), { status: 503 }),
        )
      : fetch(new URL(path, app.origin), { ...options, signal: lifetime.signal });
  window.EventSource = class {
    controller = new AbortController();
    constructor(path) {
      streams.add(this);
      void this.connect(path);
    }
    async connect(path) {
      try {
        const result = await fetch(new URL(path, app.origin), {
          headers: { Accept: "text/event-stream" },
          signal: AbortSignal.any([this.controller.signal, lifetime.signal]),
        });
        if (!result.ok) throw new Error("Event transport rejected");
        this.onopen?.();
        let pending = "";
        for await (const chunk of result.body.pipeThrough(new TextDecoderStream())) {
          pending += chunk;
          while (true) {
            const index = pending.indexOf("\n\n");
            if (index < 0) break;
            const frame = pending.slice(0, index);
            pending = pending.slice(index + 2);
            const data = frame.split("\n").find((line) => line.startsWith("data: "));
            if (data) this.onmessage?.({ data: data.slice(6) });
          }
        }
      } catch {
        if (!this.controller.signal.aborted) this.onerror?.();
      }
    }
    close() {
      this.controller.abort();
      streams.delete(this);
    }
  };
  window.eval(await readFile("web/chat.js", "utf8"));
  const get = (id) => window.document.getElementById(id);
  const click = (id) => get(id).click();
  const send = async (text, mode = "chat") => {
    get("mode").value = mode;
    get("mode").dispatchEvent(new window.Event("change"));
    get("prompt").value = text;
    get("composer").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await until(() => get("messages").textContent.includes(text));
  };
  return {
    window,
    get,
    click,
    send,
    origin: app.origin,
    close: async () => {
      lifetime.abort();
      for (const stream of streams) stream.close();
      await app.close();
      // Let aborted fetch/JSON promise handlers settle while their document still exists.
      await new Promise((resolve) => setImmediate(resolve));
      window.close();
    },
  };
}

test("workspace shell declares desktop, iPad and narrow responsive layouts", async () => {
  const [base, product] = await Promise.all([
    readFile("web/chat.css", "utf8"),
    readFile("web/product-m1.css", "utf8"),
  ]);
  assert.match(base, /@media \(max-width: 1150px\)/u);
  assert.match(base, /@media \(max-width: 900px\)/u);
  assert.match(product, /@media \(max-width: 1100px\)/u);
  assert.match(product, /@media \(max-width: 900px\)/u);
  assert.match(product, /@media \(max-width: 620px\)/u);
  assert.match(product, /\.project-nav[\s\S]*overflow-x: auto/u);
});

test("landing links select a known mode without sending a task or accepting unknown modes", async () => {
  for (const mode of ["coding", "research", "ultra", "untrusted-mode"]) {
    const c = await client({ mode });
    try {
      await until(() => c.get("connection").textContent === "Connected");
      assert.equal(c.get("mode").value, mode === "untrusted-mode" ? "chat" : mode);
      assert.equal(c.get("messages").querySelectorAll("article").length, 0);
    } finally {
      await c.close();
    }
  }
});

test("shipped UI sends real HTTP missions, changes modes, reopens history and clears private state on logout", async () => {
  const c = await client();
  try {
    await until(() => c.get("connection").textContent === "Connected");
    assert.deepEqual(
      [...c.window.document.querySelectorAll(".sidebar [id$='-view']")].map(
        (item) =>
          item.textContent
            .trim()
            .replace(/^[^A-Za-z]+/u, "")
            .split(/\s+/u)[0],
      ),
      ["Home", "Projects", "Knowledge", "Skills", "Activity", "Connections", "System", "Evidence"],
    );
    for (const mode of ["chat", "thinking", "ultra"]) {
      await c.send(`DOM ${mode} scenario`, mode);
      await until(() => !c.get("send").disabled && c.get("task-controls").hidden);
      assert.match(c.get("messages").textContent, /Browser fixture response/u);
      assert.equal(c.get("run-companion-state").textContent, "SUCCESS");
      assert.equal(c.get("plan").querySelectorAll("li.done").length, 3);
    }
    c.click("new-chat");
    await until(() => c.get("messages").querySelectorAll("article").length === 0);
    c.get("conversation-list").querySelector("button").click();
    await until(() => c.get("messages").textContent.includes("DOM ultra scenario"));
    assert.match(c.window.location.search, /project=/u);
    assert.equal(c.get("project-nav").hidden, false);
    c.click("sign-out");
    await until(() => c.get("login").open);
    assert.equal(c.get("messages").querySelectorAll("article").length, 0);
    assert.equal(c.get("conversation-list").children.length, 0);
    assert.equal(c.get("send").disabled, true);
  } finally {
    await c.close();
  }
});

test("Coding UI renders actual file changes and connects the isolated preview response", async () => {
  const c = await client();
  try {
    await until(() => c.get("connection").textContent === "Connected");
    await c.send("Build an interactive page for this DOM fixture", "coding");
    await until(() => c.get("files").textContent.includes("index.html"));
    await until(() => c.get("task-controls").hidden);
    c.get("files").querySelector("button").click();
    assert.match(c.get("diff").textContent, /Interactive fixture/u);
    c.get("preview-file").value = "index.html";
    c.get("preview-file").dispatchEvent(new c.window.Event("change"));
    const preview = await fetch(c.get("preview").src);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-security-policy"), /sandbox allow-scripts/u);
    assert.match(await preview.text(), /Count: /u);
    assert.equal(c.get("error-banner").hidden, true);
  } finally {
    await c.close();
  }
});

test("UI pause, resume and cancel use current canonical mission versions", async () => {
  const c = await client();
  try {
    await until(() => c.get("connection").textContent === "Connected");
    await c.send("DOM slow pause scenario");
    await until(() => !c.get("task-controls").hidden);
    c.click("pause");
    await until(() => !c.get("resume").hidden);
    c.click("resume");
    await until(() => c.get("task-controls").hidden, 18000);
    await c.send("DOM slow cancel scenario");
    await until(() => !c.get("task-controls").hidden);
    c.click("cancel");
    await until(() => c.get("task-controls").hidden);
    assert.equal(c.get("error-banner").hidden, true);
  } finally {
    await c.close();
  }
});

test("Research citations and measured A/B evidence are displayed without claiming the missing pair", async () => {
  const c = await client();
  try {
    await until(() => c.get("connection").textContent === "Connected");
    await c.send("DOM research fixture", "research");
    await until(() => c.get("messages").querySelector("a") !== null);
    assert.equal(c.get("messages").querySelector("a").href, "https://en.wikipedia.org/wiki/Odin");
    c.click("benchmark-view");
    await until(() => c.get("benchmark-content").textContent.includes("INCOMPLETE"));
    const text = c.get("benchmark-content").textContent;
    assert.match(text, /2 of 3 complete task pairs/u);
    assert.match(text, /no accuracy improvement/u);
    assert.match(text, /Not measured \(rate_limit\)/u);
    assert.match(text, /Earlier M16 coding protocol comparison/u);
  } finally {
    await c.close();
  }
});

test("unavailable backends disable sending and show a clear connection state", async () => {
  const c = await client({ unavailable: true });
  try {
    await until(() => c.get("connection").textContent === "Connection unavailable");
    assert.equal(c.get("send").disabled, true);
    assert.equal(c.get("error-banner").textContent, "Test backend unavailable");
  } finally {
    await c.close();
  }
});
