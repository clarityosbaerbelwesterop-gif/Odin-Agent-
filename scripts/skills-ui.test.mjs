import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const hash = "a".repeat(64);
const tick = () => new Promise((resolve) => setImmediate(resolve));

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function skill(status = "AVAILABLE", installation = null) {
  return {
    id: "product-planning",
    name: "Product Planning",
    purpose: "Turn a product goal into bounded requirements.",
    category: "Product",
    version: "1.0.0",
    publisher: "Odin",
    trust: "BUILT_IN_VERIFIED",
    source: "M10/M15 capability packs",
    verification: "VERIFIED",
    examples: ["Shape a feature request"],
    requiredTools: [],
    requiredConnections: [],
    permissions: ["Read selected project context"],
    risk: "LOW",
    supportedScopes: ["global", "project"],
    canonicalAuthority: "M23 Skill OS",
    contentHash: hash,
    status,
    installation,
    missingConnections: [],
    executionAuthority: "M23_SKILL_OS_M25_TOOL_POLICY",
  };
}

async function app() {
  const dom = new JSDOM(await readFile("web/chat.html", "utf8"), {
    url: `https://odin.example/app?project=${projectId}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const m4run = window.document.createElement("div");
  m4run.id = "m4-run";
  window.document.querySelector(".main").append(m4run);
  const runRow = window.document.createElement("button");
  runRow.className = "m4-run-row";
  window.document.body.append(runRow);
  let installed = false;
  const calls = [];
  window.fetch = async (path, options = {}) => {
    const url = String(path);
    calls.push({ url, options });
    if (url.startsWith("/api/skills?")) {
      const installation = installed
        ? {
            installationId: "33333333-3333-4333-8333-333333333333",
            skillId: "product-planning",
            version: "1.0.0",
            contentHash: hash,
            scope: "project",
            projectId,
            enabled: true,
            previousVersion: null,
            previousContentHash: null,
            installedAt: "2026-09-13T10:00:00.000Z",
            updatedAt: "2026-09-13T10:00:00.000Z",
          }
        : null;
      return response({
        skills: [skill(installed ? "INSTALLED" : "AVAILABLE", installation)],
        drafts: [],
        connections: { github: true },
      });
    }
    if (url === "/api/skills/install" && options.method === "POST") {
      installed = true;
      return response({ authorityGranted: false }, 201);
    }
    if (url === `/api/projects/${projectId}`)
      return response({ turns: [{ id: runId, objective: "Build verified product" }] });
    if (url === `/api/skills/runs/${runId}?projectId=${projectId}`)
      return response({
        evidence: [
          {
            cursor: 44,
            type: "skill.selected",
            data: { skillName: "Product Planning", reason: "task-class match" },
            createdAt: "2026-09-13T10:05:00.000Z",
          },
        ],
        nextCursor: 44,
        note: "Only canonical Skill runtime events are shown.",
      });
    return response({ message: `Unexpected ${url}` }, 500);
  };
  window.eval(await readFile("web/skills-os.js", "utf8"));
  window.document.getElementById("skills-panel").hidden = false;
  window.document.getElementById("skills-view").click();
  await tick();
  await tick();
  return { window, calls, runRow, close: () => window.close() };
}

test("PRODUCT M5 Skills OS renders catalog, trust, permissions and persistent install actions", async () => {
  const current = await app();
  try {
    const card = current.window.document.querySelector(".m5-card");
    assert.ok(card);
    assert.match(card.textContent, /Product Planning/u);
    card.click();
    assert.match(
      current.window.document.getElementById("m5-detail").textContent,
      /Built-in verified/u,
    );
    assert.match(
      current.window.document.getElementById("m5-detail").textContent,
      /Permission disclosure/u,
    );
    current.window.document.getElementById("m5-scope").value = "project";
    current.window.document
      .getElementById("m5-scope")
      .dispatchEvent(new current.window.Event("change"));
    card.click();
    const install = [...current.window.document.querySelectorAll("#m5-detail button")].find(
      (button) => button.textContent === "Install",
    );
    assert.ok(install);
    install.click();
    await tick();
    await tick();
    const request = current.calls.find((call) => call.url === "/api/skills/install");
    assert.ok(request);
    const body = JSON.parse(request.options.body);
    assert.equal(body.scope, "project");
    assert.equal(body.projectId, projectId);
    assert.equal(body.contentHash, hash);
    assert.match(
      current.window.document.getElementById("m5-policy").textContent,
      /Installed ≠ authorized/u,
    );
  } finally {
    current.close();
  }
});

test("PRODUCT M5 custom authoring is inert and Run Center scopes real Skill evidence to Project + Run", async () => {
  const current = await app();
  try {
    assert.match(
      current.window.document.getElementById("m5-draft-dialog").textContent,
      /inert candidate/u,
    );
    assert.match(
      current.window.document.getElementById("m5-drafts").textContent,
      /No private Skill drafts/u,
    );
    current.runRow.click();
    await tick();
    await tick();
    assert.match(
      current.window.document.getElementById("m5-run-skills").textContent,
      /Product Planning/u,
    );
    assert.match(
      current.window.document.getElementById("m5-run-skills").textContent,
      /task-class match/u,
    );
    assert.ok(
      current.calls.some(
        (call) => call.url === `/api/skills/runs/${runId}?projectId=${projectId}`,
      ),
    );
  } finally {
    current.close();
  }
});

test("PRODUCT M5 responsive CSS provides single-column iPad/mobile fallbacks", async () => {
  const css = await readFile("web/product-m5.css", "utf8");
  assert.match(css, /@media \(max-width: 980px\)/u);
  assert.match(css, /grid-template-columns: 1fr/u);
  assert.match(css, /@media \(max-width: 700px\)/u);
});
