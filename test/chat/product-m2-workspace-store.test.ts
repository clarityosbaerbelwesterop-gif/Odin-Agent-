import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../../src/durable/internal.js";
import type { ActorDatabase } from "../../src/chat/neon-database.js";
import { hashText } from "../../src/chat/safety.js";
import { ChatError } from "../../src/chat/types.js";
import { WorkspaceOsStore } from "../../src/chat/workspace-os.js";

type Row = Record<string, unknown>;
type ItemRow = Row & {
  item_id: string;
  conversation_id: string;
  path: string;
  content: string;
  sha: string;
  kind: string;
  title: string | null;
  mime_type: string | null;
  origin: string;
  source_turn_id: string | null;
  source_task_id: string | null;
  version: number;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

const projectA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const projectB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const runA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const runB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

class WorkspaceHarness {
  readonly projects = new Set<string>([projectA, projectB]);
  readonly items = new Map<string, ItemRow>();
  readonly turns = new Map<string, string>();
  readonly answers = new Map<string, { data: Row; data_hash: string }>();
  readonly context = new Map<string, Map<string, { reason: string; added_at: Date }>>();
  readonly layouts = new Map<
    string,
    { open_items: string[]; active_item_id: string | null; version: number; updated_at: Date }
  >();
  readonly activity: Array<{ projectId: string; type: string; data: Row }> = [];

  readonly db = {
    transaction: async <T>(action: Parameters<ActorDatabase["transaction"]>[0]): Promise<T> =>
      action({ query: this.query } as never) as Promise<T>,
  } as unknown as ActorDatabase;

  addRun(projectId: string, turnId: string, text?: string) {
    this.turns.set(turnId, projectId);
    if (text !== undefined) {
      const data = { text };
      this.answers.set(turnId, { data, data_hash: hashText(canonicalJson(data, 300000)) });
    }
  }

  tamperAnswer(turnId: string) {
    const answer = this.answers.get(turnId);
    if (answer) answer.data_hash = "0".repeat(64);
  }

  tamperItem(itemId: string) {
    const item = this.items.get(itemId);
    if (item) item.sha = "0".repeat(64);
  }

  readonly query = async (text: string, values: readonly unknown[] = []) => {
    const sql = text.replace(/\s+/gu, " ").trim();
    const projectId = String(values[0] ?? "");

    if (sql.startsWith("SELECT 1 FROM odin_api.conversations")) {
      return { rows: this.projects.has(projectId) ? [{ exists: 1 }] : [] };
    }

    if (sql.includes("count(*)::int AS n") && sql.includes("FROM odin_api.workspace_files")) {
      const matching = [...this.items.values()].filter((item) => item.conversation_id === projectId);
      return {
        rows: [
          {
            n: matching.length,
            bytes: matching.reduce((total, item) => total + Buffer.byteLength(item.content), 0),
          },
        ],
      };
    }

    if (sql.startsWith("INSERT INTO odin_api.workspace_files")) {
      const itemId = String(values[1]);
      const now = new Date("2026-09-13T07:30:00.000Z");
      let row: ItemRow;
      if (sql.includes("'user'")) {
        row = itemRow({
          projectId,
          itemId,
          path: String(values[2]),
          content: String(values[3]),
          sha: String(values[4]),
          kind: String(values[5]),
          title: String(values[6]),
          mimeType: String(values[7]),
          origin: "user",
          now,
        });
      } else if (sql.includes("'import'")) {
        row = itemRow({
          projectId,
          itemId,
          path: String(values[2]),
          content: String(values[3]),
          sha: String(values[4]),
          kind: String(values[5]),
          title: String(values[6]),
          mimeType: String(values[7]),
          origin: "import",
          metadata: JSON.parse(String(values[8])) as Row,
          now,
        });
      } else {
        row = itemRow({
          projectId,
          itemId,
          path: String(values[2]),
          content: String(values[3]),
          sha: String(values[4]),
          kind: "GENERATED_ARTIFACT",
          title: String(values[5]),
          mimeType: "text/markdown",
          origin: "runtime",
          sourceRunId: String(values[6]),
          sourceTaskId: "work",
          now,
        });
      }
      this.items.set(itemId, row);
      return { rows: [] };
    }

    if (
      sql.includes("FROM odin_api.workspace_files") &&
      sql.includes("conversation_id=$1 AND item_id=$2") &&
      !sql.startsWith("UPDATE") &&
      !sql.startsWith("DELETE")
    ) {
      const item = this.items.get(String(values[1]));
      if (!item || item.conversation_id !== projectId) return { rows: [] };
      if (sql.startsWith("SELECT 1")) return { rows: [{ exists: 1 }] };
      if (sql.startsWith("SELECT content,version")) return { rows: [{ ...item }] };
      return { rows: [{ ...item, size: Buffer.byteLength(item.content) }] };
    }

    if (sql.startsWith("UPDATE odin_api.workspace_files SET title=$3")) {
      const item = this.items.get(String(values[1]));
      if (!item || item.conversation_id !== projectId) return { rows: [] };
      item.title = String(values[2]);
      item.content = String(values[3]);
      item.sha = String(values[4]);
      item.version += 1;
      item.updated_at = new Date("2026-09-13T07:31:00.000Z");
      return { rows: [] };
    }

    if (sql.startsWith("SELECT id FROM odin_api.turns")) {
      const turnId = String(values[1]);
      return { rows: this.turns.get(turnId) === projectId ? [{ id: turnId }] : [] };
    }

    if (sql.includes("FROM odin_api.events") && sql.includes("type='answer'")) {
      const turnId = String(values[1]);
      const answer = this.answers.get(turnId);
      return { rows: this.turns.get(turnId) === projectId && answer ? [{ ...answer }] : [] };
    }

    if (sql.startsWith("INSERT INTO odin_api.events")) {
      this.activity.push({
        projectId,
        type: String(values[1]),
        data: JSON.parse(String(values[2])) as Row,
      });
      return { rows: [] };
    }

    if (sql.includes("FROM odin_api.workspace_context_items x")) {
      const entries = this.context.get(projectId) ?? new Map();
      return {
        rows: [...entries.entries()]
          .map(([id, value]) => {
            const item = this.items.get(id);
            if (!item || item.conversation_id !== projectId) return null;
            return {
              item_id: id,
              reason: value.reason,
              added_at: value.added_at,
              title: item.title,
              path: item.path,
              kind: item.kind,
            };
          })
          .filter((row): row is NonNullable<typeof row> => row !== null),
      };
    }

    if (sql.includes("count(*)::int AS n FROM odin_api.workspace_context_items")) {
      return { rows: [{ n: this.context.get(projectId)?.size ?? 0 }] };
    }

    if (sql.startsWith("INSERT INTO odin_api.workspace_context_items")) {
      const entries = this.context.get(projectId) ?? new Map();
      entries.set(String(values[1]), {
        reason: String(values[2]),
        added_at: new Date("2026-09-13T07:32:00.000Z"),
      });
      this.context.set(projectId, entries);
      return { rows: [] };
    }

    if (sql.startsWith("DELETE FROM odin_api.workspace_context_items")) {
      this.context.get(projectId)?.delete(String(values[1]));
      return { rows: [] };
    }

    if (sql.startsWith("SELECT open_items,active_item_id,version,updated_at")) {
      const layout = this.layouts.get(projectId);
      return { rows: layout ? [{ ...layout }] : [] };
    }

    if (sql.startsWith("SELECT item_id FROM odin_api.workspace_files") && sql.includes("ANY")) {
      const ids = values[1] as readonly string[];
      return {
        rows: ids
          .filter((id) => this.items.get(id)?.conversation_id === projectId)
          .map((id) => ({ item_id: id })),
      };
    }

    if (sql.startsWith("SELECT version FROM odin_api.workspace_layouts")) {
      const layout = this.layouts.get(projectId);
      return { rows: layout ? [{ version: layout.version }] : [] };
    }

    if (sql.startsWith("INSERT INTO odin_api.workspace_layouts")) {
      this.layouts.set(projectId, {
        open_items: JSON.parse(String(values[1])) as string[],
        active_item_id: values[2] === null ? null : String(values[2]),
        version: 1,
        updated_at: new Date("2026-09-13T07:33:00.000Z"),
      });
      return { rows: [] };
    }

    if (sql.startsWith("UPDATE odin_api.workspace_layouts SET open_items=$2")) {
      const current = this.layouts.get(projectId);
      if (!current) throw new Error("Missing test layout");
      current.open_items = JSON.parse(String(values[1])) as string[];
      current.active_item_id = values[2] === null ? null : String(values[2]);
      current.version += 1;
      current.updated_at = new Date("2026-09-13T07:34:00.000Z");
      return { rows: [] };
    }

    if (sql.startsWith("SELECT item_id,path,kind,title,mime_type,origin")) {
      const needle = String(values[1] ?? "").toLowerCase();
      const rows = [...this.items.values()]
        .filter((item) => item.conversation_id === projectId)
        .filter(
          (item) =>
            !needle ||
            (item.title ?? "").toLowerCase().includes(needle) ||
            item.path.toLowerCase().includes(needle) ||
            item.content.toLowerCase().includes(needle),
        )
        .sort((left, right) => right.updated_at.getTime() - left.updated_at.getTime())
        .slice(0, 200)
        .map((item) => ({ ...item, size: Buffer.byteLength(item.content) }));
      return { rows };
    }

    throw new Error(`Unexpected workspace test query: ${sql}`);
  };
}

function itemRow(input: {
  projectId: string;
  itemId: string;
  path: string;
  content: string;
  sha: string;
  kind: string;
  title: string;
  mimeType: string;
  origin: string;
  sourceRunId?: string;
  sourceTaskId?: string;
  metadata?: Row;
  now: Date;
}): ItemRow {
  return {
    item_id: input.itemId,
    conversation_id: input.projectId,
    path: input.path,
    content: input.content,
    sha: input.sha,
    kind: input.kind,
    title: input.title,
    mime_type: input.mimeType,
    origin: input.origin,
    source_turn_id: input.sourceRunId ?? null,
    source_task_id: input.sourceTaskId ?? null,
    version: 1,
    metadata: input.metadata ?? {},
    created_at: input.now,
    updated_at: input.now,
  };
}

function expectCode(code: string) {
  return (error: unknown) => error instanceof ChatError && error.code === code;
}

test("PRODUCT M2 document lifecycle persists versions and blocks stale or runtime edits", async () => {
  const harness = new WorkspaceHarness();
  const store = new WorkspaceOsStore(harness.db);
  const created = await store.createDocument(projectA, {
    title: "Product idea",
    content: "First version",
  });
  assert.equal(created.origin, "user");
  assert.equal(created.kind, "MARKDOWN");
  assert.equal(created.version, 1);
  assert.equal((await store.item(projectA, created.id)).content, "First version");

  const updated = await store.updateDocument(projectA, created.id, {
    title: "Product idea v2",
    content: "Second version",
    expectedVersion: 1,
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.title, "Product idea v2");
  assert.equal(updated.content, "Second version");

  await assert.rejects(
    store.updateDocument(projectA, created.id, {
      title: "Stale",
      content: "Must not win",
      expectedVersion: 1,
    }),
    expectCode("STALE_DOCUMENT"),
  );

  const row = harness.items.get(created.id);
  assert.ok(row);
  row.origin = "runtime";
  await assert.rejects(
    store.updateDocument(projectA, created.id, {
      title: "Forged edit",
      content: "No",
      expectedVersion: 2,
    }),
    expectCode("READ_ONLY_ARTIFACT"),
  );
  await assert.rejects(
    store.createDocument(projectA, { title: " ", content: "x" }),
    expectCode("INVALID_TITLE"),
  );
  await assert.rejects(
    store.createDocument(projectA, { title: "Too large", content: "x".repeat(262145) }),
    expectCode("INVALID_TEXT"),
  );
});

test("PRODUCT M2 detects persisted content integrity tampering", async () => {
  const harness = new WorkspaceHarness();
  const store = new WorkspaceOsStore(harness.db);
  const document = await store.createDocument(projectA, { title: "Integrity", content: "trusted" });
  harness.tamperItem(document.id);
  await assert.rejects(store.item(projectA, document.id), expectCode("INTEGRITY_FAILURE"));
});

test("PRODUCT M2 imports supported text formats and rejects unsafe import contracts", async () => {
  const harness = new WorkspaceHarness();
  const store = new WorkspaceOsStore(harness.db);
  const fixtures = [
    ["notes.txt", "text/plain", "plain"],
    ["notes.md", "text/markdown", "# markdown"],
    ["preview.html", "text/html", "<main>safe data</main>"],
    ["data.json", "application/json", '{"ok":true}'],
  ] as const;
  for (const [filename, mimeType, content] of fixtures) {
    const imported = await store.importText(projectA, { filename, mimeType, content });
    assert.equal(imported.origin, "import");
    assert.equal(imported.mimeType, mimeType);
    assert.equal(imported.content, content);
  }
  await assert.rejects(
    store.importText(projectA, {
      filename: "broken.json",
      mimeType: "application/json",
      content: "{broken",
    }),
    expectCode("INVALID_FILE"),
  );
  await assert.rejects(
    store.importText(projectA, {
      filename: "image.png",
      mimeType: "image/png",
      content: "not an image",
    }),
    expectCode("UNSUPPORTED_FILE"),
  );
  await assert.rejects(
    store.importText(projectA, {
      filename: "large.txt",
      mimeType: "text/plain",
      content: "x".repeat(262145),
    }),
    expectCode("INVALID_TEXT"),
  );
});

test("PRODUCT M2 Run artifacts retain canonical provenance and reject forged or incomplete Runs", async () => {
  const harness = new WorkspaceHarness();
  const store = new WorkspaceOsStore(harness.db);
  harness.addRun(projectA, runA, "Verified result text");
  harness.addRun(projectB, runB, "Foreign result");

  const artifact = await store.createArtifactFromRun(projectA, runA, "Product specification");
  assert.equal(artifact.origin, "runtime");
  assert.equal(artifact.kind, "GENERATED_ARTIFACT");
  assert.equal(artifact.sourceRunId, runA);
  assert.equal(artifact.sourceTaskId, "work");
  assert.equal(artifact.content, "Verified result text");

  await assert.rejects(store.createArtifactFromRun(projectA, runB), expectCode("INVALID_PROVENANCE"));
  await assert.rejects(
    store.createArtifactFromRun(projectA, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
    expectCode("INVALID_PROVENANCE"),
  );

  const noAnswer = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  harness.addRun(projectA, noAnswer);
  await assert.rejects(store.createArtifactFromRun(projectA, noAnswer), expectCode("ARTIFACT_UNAVAILABLE"));

  const emptyAnswer = "12121212-1212-4212-8212-121212121212";
  harness.addRun(projectA, emptyAnswer, "");
  await assert.rejects(store.createArtifactFromRun(projectA, emptyAnswer), expectCode("ARTIFACT_UNAVAILABLE"));

  harness.tamperAnswer(runA);
  await assert.rejects(store.createArtifactFromRun(projectA, runA), expectCode("INTEGRITY_FAILURE"));
});

test("PRODUCT M2 Context rejects cross-project items and enforces its bounded selection", async () => {
  const harness = new WorkspaceHarness();
  const store = new WorkspaceOsStore(harness.db);
  const first = await store.createDocument(projectA, { title: "First", content: "one" });
  const foreign = await store.createDocument(projectB, { title: "Foreign", content: "two" });
  const selected = await store.setContext(projectA, first.id, true, "Current product spec");
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.itemId, first.id);
  assert.equal(selected[0]?.reason, "Current product spec");
  await assert.rejects(store.setContext(projectA, foreign.id, true), expectCode("NOT_FOUND"));
  assert.deepEqual(await store.setContext(projectA, first.id, false), []);

  const documents = await Promise.all(
    Array.from({ length: 17 }, (_, index) =>
      store.createDocument(projectA, { title: `Context ${index}`, content: String(index) }),
    ),
  );
  for (const document of documents.slice(0, 16)) await store.setContext(projectA, document.id, true);
  await assert.rejects(store.setContext(projectA, documents[16]?.id ?? "", true), expectCode("CONTEXT_LIMIT"));
});

test("PRODUCT M2 layout is durable, optimistic, item-bound and capped at twelve tabs", async () => {
  const harness = new WorkspaceHarness();
  const store = new WorkspaceOsStore(harness.db);
  const documents = await Promise.all(
    Array.from({ length: 13 }, (_, index) =>
      store.createDocument(projectA, { title: `Tab ${index}`, content: String(index) }),
    ),
  );
  const saved = await store.saveLayout(
    projectA,
    documents.map((document) => document.id),
    documents[0]?.id ?? null,
    0,
  );
  assert.equal(saved.version, 1);
  assert.equal(saved.openItemIds.length, 12);
  assert.equal((await store.layout(projectA)).activeItemId, documents[0]?.id);

  await assert.rejects(
    store.saveLayout(projectA, [documents[0]?.id ?? ""], documents[0]?.id ?? null, 0),
    expectCode("STALE_LAYOUT"),
  );
  await assert.rejects(
    store.saveLayout(projectA, [documents[0]?.id ?? ""], documents[1]?.id ?? null, 1),
    expectCode("INVALID_LAYOUT"),
  );
  await assert.rejects(
    store.saveLayout(
      projectA,
      ["34343434-3434-4434-8434-343434343434"],
      "34343434-3434-4434-8434-343434343434",
      1,
    ),
    expectCode("INVALID_LAYOUT"),
  );
});

test("PRODUCT M2 search is textual, bounded and cannot cross Project scope", async () => {
  const harness = new WorkspaceHarness();
  const store = new WorkspaceOsStore(harness.db);
  await store.createDocument(projectA, { title: "Pricing", content: "Enterprise price is 29" });
  await store.createDocument(projectA, { title: "Research", content: "Competitor notes" });
  await store.createDocument(projectB, { title: "Pricing foreign", content: "Enterprise price is 999" });

  const title = await store.items(projectA, "Pricing");
  assert.equal(title.length, 1);
  assert.equal(title[0]?.title, "Pricing");
  const content = await store.items(projectA, "Competitor");
  assert.equal(content.length, 1);
  assert.equal(content[0]?.title, "Research");
  assert.equal((await store.items(projectA, "999")).length, 0);
  assert.ok((await store.items(projectA)).length <= 200);
});
