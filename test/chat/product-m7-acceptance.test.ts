import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { aggregateChanges } from "../../src/chat/coding-product.js";
import { hashText } from "../../src/chat/safety.js";
import { fixture, provider, response, until } from "./helpers.js";

test("PRODUCT M7 acceptance #1 fixes a failing login test through inspect, patch, failed check, repair and green verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "odin-m7-login-"));
  const before = "export const canLogin = (password) => password.length > 0;\n";
  const wrong = "export const canLogin = (password) => password.length >= 4;\n";
  const fixed = "export const canLogin = (password) => password.length >= 8;\n";
  await writeFile(join(root, "login.js"), before);
  await writeFile(join(root, "login.test.js"), "// requires at least eight characters\n");

  const model = provider((_request, call) => {
    if (call === 1)
      return response("", [{ id: "read-login", name: "repo_read", arguments: { path: "login.js", maxBytes: 4000 } }]);
    if (call === 2)
      return response("", [{ id: "patch-first", name: "repo_patch", arguments: { path: "login.js", expectedSha: hashText(before), content: wrong } }]);
    if (call === 3)
      return response("", [{ id: "test-first", name: "repo_quality", arguments: { commandId: "login-tests" } }]);
    if (call === 4)
      return response("", [{ id: "patch-repair", name: "repo_patch", arguments: { path: "login.js", expectedSha: hashText(wrong), content: fixed } }]);
    if (call === 5)
      return response("", [{ id: "test-repair", name: "repo_quality", arguments: { commandId: "login-tests" } }]);
    return response("The login validation is fixed and the required test now passes.");
  });

  const f = await fixture(model, {
    workspaceRoot: root,
    allowWorkspaceWrites: true,
    quality: {
      commands: () => [{ id: "login-tests", label: "login unit test" }],
      run: async () => ({
        exitCode: (await readFile(join(root, "login.js"), "utf8")) === fixed ? 0 : 1,
        output: (await readFile(join(root, "login.js"), "utf8")) === fixed ? "1 login test passed" : "login test failed",
      }),
    },
  });
  try {
    const turn = await f.submit("Fix the failing login test.", "coding");
    await f.engine.idle();
    assert.equal((await f.engine.view(turn.id)).state, "COMPLETED");
    assert.equal(await readFile(join(root, "login.js"), "utf8"), fixed);
    const events = f.store.events(f.conversation.id).filter((item) => item.turnId === turn.id);
    const quality = events.filter((item) => item.type === "quality");
    assert.deepEqual(quality.map((item) => item.data.passed), [false, true]);
    const changes = aggregateChanges(events);
    assert.equal(changes.length, 1);
    assert.match(changes[0]?.diff ?? "", /password\.length >= 8/u);
    assert(events.some((item) => item.type === "plan"));
  } finally {
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("PRODUCT M7 acceptance #2 resumes the same multi-file feature Run and verifies both scoped changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "odin-m7-feature-"));
  const appBefore = "export const theme = 'light';\n";
  const uiBefore = "export const label = 'Settings';\n";
  const appAfter = "export const theme = 'system';\n";
  const uiAfter = "export const label = 'Appearance';\n";
  await writeFile(join(root, "app.js"), appBefore);
  await writeFile(join(root, "ui.js"), uiBefore);

  let waiting = false;
  const model = provider(async (_request, call, options) => {
    if (call === 1)
      return response("", [{ id: "read-app", name: "repo_read", arguments: { path: "app.js", maxBytes: 4000 } }]);
    if (call === 2)
      return response("", [{ id: "patch-app", name: "repo_patch", arguments: { path: "app.js", expectedSha: hashText(appBefore), content: appAfter } }]);
    if (call === 3) {
      waiting = true;
      await new Promise<void>((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("paused")), { once: true }));
    }
    if (call === 4)
      return response("", [{ id: "read-ui", name: "repo_read", arguments: { path: "ui.js", maxBytes: 4000 } }]);
    if (call === 5)
      return response("", [{ id: "patch-ui", name: "repo_patch", arguments: { path: "ui.js", expectedSha: hashText(uiBefore), content: uiAfter } }]);
    if (call === 6)
      return response("", [{ id: "feature-check", name: "repo_quality", arguments: { commandId: "feature-tests" } }]);
    return response("The existing application now has the scoped appearance feature and verification passed.");
  });

  const f = await fixture(model, {
    workspaceRoot: root,
    allowWorkspaceWrites: true,
    quality: {
      commands: () => [{ id: "feature-tests", label: "feature integration checks" }],
      run: async () => ({
        exitCode:
          (await readFile(join(root, "app.js"), "utf8")) === appAfter &&
          (await readFile(join(root, "ui.js"), "utf8")) === uiAfter
            ? 0
            : 1,
        output: "feature integration verification",
      }),
    },
  });
  try {
    const turn = await f.submit("Add a system appearance preference without replacing the existing architecture.", "coding");
    await until(() => waiting);
    const paused = await f.engine.control(turn.id, "pause", (await f.engine.view(turn.id)).version);
    assert.equal(paused.state, "PAUSED");
    await f.engine.idle();
    await f.engine.control(turn.id, "resume", paused.version);
    await f.engine.idle();
    assert.equal((await f.engine.view(turn.id)).state, "COMPLETED");
    assert.equal(await readFile(join(root, "app.js"), "utf8"), appAfter);
    assert.equal(await readFile(join(root, "ui.js"), "utf8"), uiAfter);
    const events = f.store.events(f.conversation.id).filter((item) => item.turnId === turn.id);
    assert.equal(aggregateChanges(events).length, 2);
    assert.equal(events.filter((item) => item.type === "quality" && item.data.passed === true).length, 1);
  } finally {
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});
