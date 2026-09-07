import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { assemblePreview, PREVIEW_CSP } from "../../src/chat/preview.js";
import { ChatStore } from "../../src/chat/store.js";

test("future conversation schemas are refused before modifying their tables", async () => {
  const root = await mkdtemp(join(tmpdir(), "odin-future-"));
  const path = join(root, "future.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec("CREATE TABLE chat_schema(version INTEGER); INSERT INTO chat_schema VALUES(2)");
    assert.throws(() => new ChatStore(path), /Unsupported conversation schema/u);
    assert.equal(
      db.prepare("SELECT name FROM sqlite_master WHERE name='chat_conversations'").get(),
      undefined,
    );
    assert.equal(db.prepare("SELECT version FROM chat_schema").get()?.version, 2);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("nested preview resolves root assets and local assets without granting network or origin access", () => {
  const html = assemblePreview(
    [
      {
        path: "nested/index.html",
        content:
          '<link rel="stylesheet" href="../theme.css?v=1"><script src="/app.js"></script><script src="https://example.org/remote.js"></script>',
      },
      { path: "theme.css", content: "body{color:red}" },
      { path: "app.js", content: "document.body.dataset.checked='yes'" },
      { path: "nested/app.js", content: "WRONG_FILE" },
    ],
    "nested/index.html",
  );
  assert.match(html, /<style>body\{color:red\}<\/style>/u);
  assert.match(html, /dataset.checked/u);
  assert.doesNotMatch(html, /WRONG_FILE/u);
  assert.match(PREVIEW_CSP, /connect-src 'none'/u);
  assert.doesNotMatch(PREVIEW_CSP, /allow-same-origin|https:/u);
  assert.throws(() => assemblePreview([], "../private.html"));
});
