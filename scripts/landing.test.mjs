import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

test("landing exposes working app links, local assets and complete section targets", async () => {
  const html = await readFile("web/landing.html", "utf8");
  const dom = new JSDOM(html, { url: "https://odin.example" });
  try {
    const doc = dom.window.document;
    assert.equal(doc.documentElement.lang, "de");
    assert.equal(doc.querySelectorAll("h1").length, 1);
    assert(doc.querySelector("main"));
    assert.equal(doc.querySelectorAll("form").length, 0);
    for (const link of doc.querySelectorAll('a[href^="#"]'))
      assert(doc.getElementById(link.getAttribute("href").slice(1)));
    for (const element of doc.querySelectorAll("script[src],link[rel=stylesheet]")) {
      const path = element.getAttribute("src") ?? element.getAttribute("href");
      assert.match(path, /^\/landing\.(js|css)$/u);
      assert((await readFile(`web${path}`, "utf8")).length > 0);
    }
    assert(doc.querySelectorAll('a[href^="/app"]').length >= 4);
    assert.equal(await readFile("dist/public/index.html", "utf8"), html);
    assert.match(await readFile("dist/public/chat.html", "utf8"), /id="composer"/u);
    const deployment = JSON.parse(await readFile("vercel.json", "utf8"));
    assert(
      deployment.rewrites.some(
        (rule) => rule.source === "/app" && rule.destination === "/chat.html",
      ),
    );
    const security = deployment.headers.find((rule) => rule.source === "/app");
    assert(
      security.headers.some(
        (header) =>
          header.key === "Content-Security-Policy" &&
          header.value.includes("frame-ancestors 'none'"),
      ),
    );
  } finally {
    dom.window.close();
  }
});

test("all five landing modes update actual descriptions and hand off without simulated inference", async () => {
  const dom = new JSDOM(await readFile("web/landing.html", "utf8"), {
    url: "https://odin.example",
    runScripts: "outside-only",
  });
  try {
    const { window } = dom;
    window.fetch = () => {
      throw new Error("Landing must not perform inference or submit credentials");
    };
    window.eval(await readFile("web/landing.js", "utf8"));
    const buttons = [...window.document.querySelectorAll("[data-mode]")];
    assert.equal(buttons.length, 5);
    for (const button of buttons) {
      button.click();
      assert.equal(window.document.querySelectorAll('[aria-pressed="true"]').length, 1);
      assert.equal(button.getAttribute("aria-pressed"), "true");
      assert.equal(
        window.document.getElementById("mode-open").getAttribute("href"),
        `/app?mode=${button.dataset.mode}`,
      );
      assert.equal(window.document.querySelectorAll("#mode-steps li").length, 3);
      assert(window.document.getElementById("mode-boundary").textContent.length > 70);
    }
    assert.match(
      window.document.getElementById("mode-boundary").textContent,
      /keine Berechtigungen/u,
    );
    assert.match(window.document.body.textContent, /KEIN LIVE-RUN/u);
  } finally {
    dom.window.close();
  }
});

test("landing benchmark numbers match the checked-in acquisition, including its failed pair", async () => {
  const data = JSON.parse(await readFile("docs/evals/chathub-ab-2026-09-07.json", "utf8"));
  const dom = new JSDOM(await readFile("web/landing.html", "utf8"));
  try {
    const pairs = data.cases.filter((item) => item.baseline.complete && item.odin.complete);
    assert.equal(data.status, "INCOMPLETE");
    assert.equal(pairs.length, 2);
    assert.equal(data.cases.length, 3);
    const cells = [...dom.window.document.querySelectorAll("tbody td")].map(
      (cell) => cell.textContent,
    );
    assert.deepEqual(cells.slice(0, 2), ["2 / 2", "2 / 2"]);
    for (const [index, arm] of ["baseline", "odin"].entries()) {
      assert(pairs.every((pair) => pair[arm].passed));
      assert.equal(
        Number(cells[index + 2].replaceAll(".", "")),
        pairs.reduce((total, pair) => total + pair[arm].usage.totalTokens, 0),
      );
    }
    assert.match(dom.window.document.body.textContent, /keinen Genauigkeitsgewinn/u);
    assert.match(
      dom.window.document.body.textContent,
      /E-Mail-Zustellung ist noch nicht live bestätigt/u,
    );
  } finally {
    dom.window.close();
  }
});
