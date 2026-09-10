import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function workspaceClient() {
  const dom = new JSDOM(await readFile("web/chat.html", "utf8"), {
    url: "https://odin.example/app",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const window = dom.window;
  if (!window.HTMLDialogElement.prototype.showModal)
    window.HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
  if (!window.HTMLDialogElement.prototype.close)
    window.HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  const saves = [];
  window.fetch = async (path, options = {}) => {
    const value = String(path);
    if (value === "/api/config")
      return new Response(
        JSON.stringify({
          github: { connected: true, login: "person", repository: null, defaultBranch: null },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    if (value === "/api/github/repositories")
      return new Response(
        JSON.stringify({
          repositories: [
            {
              fullName: "person/odin",
              owner: "person",
              name: "odin",
              private: true,
              archived: false,
              defaultBranch: "main",
              updatedAt: "2026-09-10T12:00:00Z",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    if (value.startsWith("/api/github/branches?repository="))
      return new Response(
        JSON.stringify({
          branches: [
            { name: "main", protected: true, commitSha: "a".repeat(40) },
            { name: "feature/mobile", protected: false, commitSha: "b".repeat(40) },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    if (value === "/api/github/repository" && options.method === "PUT") {
      saves.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ connected: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: "Unexpected request" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  };
  window.eval(await readFile("web/workspace.js", "utf8"));
  await tick();
  return {
    window,
    saves,
    get: (id) => window.document.getElementById(id),
    close: () => window.close(),
  };
}

test("workspace picker loads real repositories, searches and loads branches", async () => {
  const client = await workspaceClient();
  try {
    client.get("workspace-picker-button").click();
    await tick();
    await tick();
    assert.equal(client.get("workspace-picker").open, true);
    assert.match(client.get("workspace-account").textContent, /@person/u);
    assert.match(client.get("workspace-repositories").textContent, /odin/u);

    client.get("workspace-search").value = "missing";
    client.get("workspace-search").dispatchEvent(new client.window.Event("input"));
    assert.match(client.get("workspace-repositories").textContent, /Keine passenden/u);

    client.get("workspace-search").value = "odin";
    client.get("workspace-search").dispatchEvent(new client.window.Event("input"));
    client.get("workspace-repositories").querySelector("button").click();
    await tick();
    assert.match(client.get("workspace-branches").textContent, /feature\/mobile/u);
    assert.equal(client.get("workspace-save").dataset.branch, "main");
  } finally {
    client.close();
  }
});

test("workspace save sends explicit repository and selected branch", async () => {
  const client = await workspaceClient();
  try {
    client.get("workspace-picker-button").click();
    await tick();
    await tick();
    client.get("workspace-repositories").querySelector("button").click();
    await tick();
    const branch = [...client.get("workspace-branches").querySelectorAll("button")].find(
      (item) => item.dataset.name === "feature/mobile",
    );
    branch.click();
    client.get("workspace-save").click();
    await tick();
    assert.deepEqual(client.saves[0], {
      repository: "person/odin",
      branch: "feature/mobile",
    });
  } finally {
    client.close();
  }
});
