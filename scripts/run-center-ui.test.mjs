import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const tick = () => new Promise((resolve) => setImmediate(resolve));

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function app() {
  const dom = new JSDOM(await readFile("web/chat.html", "utf8"), {
    url: `https://odin.example/app?project=${projectId}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const calls = [];
  window.fetch = async (path, options = {}) => {
    const url = String(path);
    calls.push({ url, options });
    if (url === `/api/projects/${projectId}`)
      return response({
        conversation: {
          id: projectId,
          title: "Odin Product",
          createdAt: "2026-09-13T08:00:00.000Z",
        },
        turns: [
          {
            id: runId,
            conversationId: projectId,
            modelId: "test-model",
            mode: "coding",
            objective: "Productize the existing runtime",
            createdAt: "2026-09-13T08:01:00.000Z",
            state: "REPAIRING",
            version: 7,
            companionState: "REPAIRING",
            usage: { inputTokens: 400, outputTokens: 200, totalTokens: 600 },
            plan: [
              {
                id: "understand",
                title: "Understand the goal",
                status: "done",
                dependsOn: [],
                definitionOfDone: ["Goal is clear."],
              },
              {
                id: "work",
                title: "Execute existing runtime",
                status: "done",
                dependsOn: ["understand"],
                definitionOfDone: ["Work is implemented."],
              },
              {
                id: "verify",
                title: "Verify evidence",
                status: "active",
                dependsOn: ["work"],
                definitionOfDone: ["Evidence passes."],
              },
            ],
          },
        ],
      });
    if (url === `/api/projects/${projectId}/events?after=0`)
      return response({
        events: [
          {
            cursor: 1,
            turnId: runId,
            type: "state",
            data: { state: "REPAIRING" },
            createdAt: "2026-09-13T08:02:00.000Z",
          },
          {
            cursor: 2,
            turnId: runId,
            type: "tool.start",
            data: { name: "repository.patch" },
            createdAt: "2026-09-13T08:03:00.000Z",
          },
          {
            cursor: 3,
            turnId: runId,
            type: "quality",
            data: { passed: false, commandId: "test" },
            createdAt: "2026-09-13T08:04:00.000Z",
          },
          {
            cursor: 4,
            turnId: runId,
            type: "verification",
            data: { outcome: "REPAIR_REQUIRED", scope: "repository", failures: ["2 tests failed"] },
            createdAt: "2026-09-13T08:05:00.000Z",
          },
          {
            cursor: 5,
            turnId: runId,
            type: "quality",
            data: { passed: true, commandId: "test" },
            createdAt: "2026-09-13T08:06:00.000Z",
          },
          {
            cursor: 6,
            turnId: runId,
            type: "verification",
            data: { outcome: "PASS", scope: "repository", failures: [] },
            createdAt: "2026-09-13T08:07:00.000Z",
          },
          {
            cursor: 7,
            turnId: runId,
            type: "memory.brain.pulse",
            data: {
              selectedMemoryIds: ["memory-a"],
              selectedWorkspaceReferences: ["odin://workspace/spec"],
              contextResultHash: "a".repeat(64),
            },
            createdAt: "2026-09-13T08:08:00.000Z",
          },
          {
            cursor: 8,
            turnId: runId,
            type: "file.changed",
            data: { path: "src/app.ts" },
            createdAt: "2026-09-13T08:09:00.000Z",
          },
        ],
      });
    if (url === `/api/workspace/projects/${projectId}`)
      return response({
        items: [
          {
            id: "artifact-a",
            title: "Verification report",
            kind: "MARKDOWN",
            version: 1,
            sourceRunId: runId,
          },
        ],
      });
    if (url === "/api/config") return response({ limits: { maxToolCalls: 20 } });
    if (url === `/api/turns/${runId}`)
      return response({ id: runId, state: "REPAIRING", version: 7 });
    if (url === `/api/turns/${runId}/steer` && options.method === "POST")
      return response({ ok: true });
    if (url === `/api/turns/${runId}/control` && options.method === "POST")
      return response({ id: runId, state: "PAUSED", version: 8 });
    return response({ message: `Unexpected ${url}` }, 500);
  };
  window.EventSource = undefined;
  window.eval(await readFile("web/run-center.js", "utf8"));
  return { window, calls, close: () => window.close() };
}

test("PRODUCT M4 Run Center renders canonical history, dependencies, evidence and context", async () => {
  const current = await app();
  try {
    current.window.document.querySelector('[data-project-section="runs"]').click();
    await tick();
    await tick();
    assert.equal(current.window.document.querySelectorAll(".m4-run-row").length, 1);
    assert.match(current.window.document.getElementById("m4-goal").textContent, /Productize/u);
    assert.match(
      current.window.document.getElementById("m4-dag").textContent,
      /Depends on understand/u,
    );
    assert.match(
      current.window.document.getElementById("m4-verification").textContent,
      /2 tests failed/u,
    );
    assert.match(current.window.document.getElementById("m4-verification").textContent, /PASS/u);
    assert.match(
      current.window.document.getElementById("m4-context").textContent,
      /1 Memory · 1 Workspace/u,
    );
    assert.match(
      current.window.document.getElementById("m4-context").textContent,
      /Verification report/u,
    );
    assert.match(
      current.window.document.getElementById("m4-governance").textContent,
      /Repair cycles/u,
    );
  } finally {
    current.close();
  }
});

test("PRODUCT M4 controls remain server-authoritative and replan is steering", async () => {
  const current = await app();
  try {
    current.window.document.querySelector('[data-project-section="runs"]').click();
    await tick();
    await tick();
    const buttons = [...current.window.document.querySelectorAll("#m4-controls button")];
    buttons.find((button) => button.textContent === "Pause").click();
    await tick();
    await tick();
    assert.ok(current.calls.some((call) => call.url === `/api/turns/${runId}`));
    const control = current.calls.find((call) => call.url === `/api/turns/${runId}/control`);
    assert.ok(control);
    assert.deepEqual(JSON.parse(control.options.body), { command: "pause", expectedVersion: 7 });
    const replan = buttons.find((button) => button.textContent === "Request replan");
    replan.click();
    await tick();
    assert.ok(current.calls.some((call) => call.url === `/api/turns/${runId}/steer`));
  } finally {
    current.close();
  }
});

test("PRODUCT M4 Run Center contains no private-reasoning projection and keeps iPad layouts", async () => {
  const [client, css, projection] = await Promise.all([
    readFile("web/run-center.js", "utf8"),
    readFile("web/product-m4.css", "utf8"),
    readFile("src/chat/product-projection.ts", "utf8"),
  ]);
  assert.match(client, /See the work, not hidden reasoning/u);
  assert.doesNotMatch(client, /chain[- ]of[- ]thought|private reasoning|reasoning trace/iu);
  assert.match(projection, /dependsOn: \[\.\.\.\(task\.dependsOn \?\? \[\]\)\]/u);
  assert.match(css, /@media\s*\(max-width:\s*820px\)/u);
  assert.match(css, /env\(safe-area-inset-bottom\)/u);
  assert.match(css, /scroll-snap-type:\s*x proximity/u);
});
