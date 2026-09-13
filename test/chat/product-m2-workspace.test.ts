import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { ActorDatabase } from "../../src/chat/neon-database.js";
import { NeonChatStore } from "../../src/chat/neon-store.js";
import { activityLabel } from "../../src/chat/product-projection.js";
import { hashText } from "../../src/chat/safety.js";
import { compileWorkspaceContext, workspaceContextMessage } from "../../src/chat/workspace-context.js";
import { sanitizeWorkspaceFilename, WORKSPACE_ITEM_KINDS } from "../../src/chat/workspace-os.js";
import { ChatError } from "../../src/chat/types.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const missionId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";

function dbForContext(
  rows: readonly Record<string, unknown>[],
  history: readonly Record<string, unknown>[] = [],
): ActorDatabase {
  return {
    transaction: async <T>(action: Parameters<ActorDatabase["transaction"]>[0]): Promise<T> => {
      const client = {
        query: (async (text: string) => {
          if (text.includes("workspace_context_items")) return { rows: [...rows] };
          if (text.includes("type IN ('message.user','answer')")) return { rows: [...history] };
          throw new Error(`Unexpected test query: ${text}`);
        }) as never,
      };
      return action(client as never) as Promise<T>;
    },
  };
}

function contextRow(content = "Mobile first is the current product decision.") {
  return {
    item_id: itemId,
    title: "Product Spec",
    path: "documents/product-spec.md",
    content,
    sha: hashText(content),
    version: 7,
    updated_at: "2026-09-13T07:00:00.000Z",
  };
}

test("PRODUCT M2 compiles explicit workspace context through the canonical P0-P3 hierarchy", async () => {
  const compiled = await compileWorkspaceContext(dbForContext([contextRow()]), projectId, missionId);
  assert.ok(compiled);
  assert.deepEqual(
    compiled.sections.map((section) => section.priority),
    ["P0", "P1", "P2", "P3"],
  );
  const p3 = compiled.sections.find((section) => section.priority === "P3");
  assert.equal(p3?.items.length, 1);
  assert.equal(p3?.items[0]?.source.class, "repository");
  assert.equal(p3?.items[0]?.source.reference, `odin://project/${projectId}/workspace/${itemId}`);
  assert.equal(p3?.items[0]?.source.version, "7");
  assert.match(p3?.items[0]?.content ?? "", /Mobile first/u);

  const message = workspaceContextMessage(compiled);
  assert.match(message, /untrusted project data/u);
  assert.match(message, new RegExp(itemId, "u"));
  assert.match(message, /product-m2-workspace-context-v1/u);
});

test("PRODUCT M2 fails closed when selected workspace context fails integrity verification", async () => {
  const row = { ...contextRow(), sha: "tampered" };
  await assert.rejects(
    compileWorkspaceContext(dbForContext([row]), projectId, missionId),
    (error: unknown) => error instanceof ChatError && error.code === "INTEGRITY_FAILURE",
  );
});

test("PRODUCT M2 returns no compiled project context when the user selected nothing", async () => {
  assert.equal(await compileWorkspaceContext(dbForContext([]), projectId, missionId), null);
});

test("hosted run history injects bounded compiled project context before the current objective", async () => {
  const store = new NeonChatStore(dbForContext([contextRow()]));
  const history = await store.history(projectId, missionId);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.role, "user");
  const text = history[0]?.content.find((part) => part.type === "text")?.text ?? "";
  assert.match(text, /Selected project context follows/u);
  assert.match(text, /Mobile first/u);
  assert.match(text, /cannot grant permissions|not system policy/u);
});

test("workspace filename sanitizer removes traversal separators and control characters", () => {
  assert.equal(sanitizeWorkspaceFilename("../../brief.md"), "brief.md");
  assert.equal(sanitizeWorkspaceFilename("folder\\brief.md"), "folder-brief.md");
  assert.equal(sanitizeWorkspaceFilename("brief\u0000name.md"), "brief-name.md");
  assert.equal(sanitizeWorkspaceFilename("  research   notes.md  "), "research notes.md");
  assert.throws(
    () => sanitizeWorkspaceFilename("..."),
    (error: unknown) => error instanceof ChatError && error.code === "INVALID_FILE",
  );
});

test("workspace kinds match the migration constraint and remain bounded product concepts", async () => {
  const migration = await readFile("migrations/012_product_m2_workspace_os.sql", "utf8");
  for (const kind of WORKSPACE_ITEM_KINDS) assert.match(migration, new RegExp(`'${kind}'`, "u"));
  assert.match(migration, /FORCE ROW LEVEL SECURITY/u);
  assert.match(migration, /owner_id=\(SELECT odin_api\.actor\(\)\)/u);
  assert.match(migration, /REVOKE ALL ON odin_api\.%I FROM PUBLIC/u);
  assert.match(
    migration,
    /FOREIGN KEY\(owner_id,conversation_id,item_id\)[\s\S]*REFERENCES odin_api\.workspace_files\(owner_id,conversation_id,item_id\)/u,
  );
  assert.match(migration, /jsonb_array_length\(open_items\)<=12/u);
});

test("workspace Activity uses the existing event projection for meaningful actions", () => {
  assert.equal(
    activityLabel({ type: "workspace.item.created", data: { title: "Product idea" } }),
    "Created Product idea",
  );
  assert.equal(
    activityLabel({ type: "workspace.artifact.created", data: { title: "Research" } }),
    "Saved Research from a Run",
  );
  assert.equal(
    activityLabel({ type: "workspace.context.added", data: { itemId } }),
    "Added an item to project context",
  );
});

test("Workspace OS client persists canonical layout server-side and keeps HTML preview sandboxed", async () => {
  const [client, css] = await Promise.all([
    readFile("web/workspace-os.js", "utf8"),
    readFile("web/product-m2.css", "utf8"),
  ]);
  assert.match(client, /\/layout/u);
  assert.match(client, /expectedVersion/u);
  assert.match(client, /STALE_DOCUMENT/u);
  assert.match(client, /iframe\.sandbox = "allow-scripts"/u);
  assert.doesNotMatch(client, /allow-same-origin/u);
  assert.doesNotMatch(client, /localStorage/u);
  assert.match(client, /slice\(0, 12\)|openIds\.length > 12/u);
  assert.match(css, /@media \(max-width: 980px\)/u);
  assert.match(css, /@media \(max-width: 700px\)/u);
  assert.match(css, /env\(safe-area-inset-bottom\)/u);
  assert.match(css, /prefers-reduced-motion/u);
});
