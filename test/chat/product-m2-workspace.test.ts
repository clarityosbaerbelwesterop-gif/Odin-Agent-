import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalJson } from "../../src/durable/internal.js";
import type { ActorDatabase } from "../../src/chat/neon-database.js";
import { NeonChatStore } from "../../src/chat/neon-store.js";
import { activityLabel } from "../../src/chat/product-projection.js";
import { hashText } from "../../src/chat/safety.js";
import { ChatError } from "../../src/chat/types.js";
import {
  compileWorkspaceContext,
  workspaceContextMessage,
} from "../../src/chat/workspace-context.js";
import { sanitizeWorkspaceFilename, WORKSPACE_ITEM_KINDS } from "../../src/chat/workspace-os.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const missionId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";

function dbForContext(
  rows: readonly Record<string, unknown>[],
  history: readonly Record<string, unknown>[] = [],
): ActorDatabase {
  const currentTurn = {
    id: missionId,
    conversationId: projectId,
    mode: "chat",
    modelId: "test-model",
    objective: "Continue the current Project.",
    createdAt: "2026-09-13T07:00:00.000Z",
  };
  const turnRow = {
    data: currentTurn,
    data_hash: hashText(canonicalJson(currentTurn, 2_000_000)),
  };
  return {
    transaction: async <T>(action: Parameters<ActorDatabase["transaction"]>[0]): Promise<T> => {
      const client = {
        query: (async (text: string) => {
          if (text.includes("workspace_context_items")) return { rows: [...rows] };
          if (text.includes("FROM odin_api.memory_records m")) return { rows: [] };
          if (text.includes("UPDATE odin_api.memory_product_signals")) return { rows: [] };
          if (text.includes("INSERT INTO odin_api.events")) return { rows: [] };
          if (text.includes("type IN ('message.user','answer')")) return { rows: [...history] };
          if (text === "SELECT data,data_hash FROM odin_api.turns WHERE id=$1")
            return { rows: [turnRow] };
          if (text.includes("SELECT 1 FROM odin_api.turns") && text.includes("conversation_id=$2"))
            return { rows: [{ ok: true }] };
          if (text.includes("FROM odin_api.github_connections")) return { rows: [] };
          if (text.includes("FROM odin_api.skill_installations")) return { rows: [] };
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
  const compiled = await compileWorkspaceContext(
    dbForContext([contextRow()]),
    projectId,
    missionId,
  );
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
  assert.match(message, /product-m3-workspace-memory-context-v2/u);
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

test("workspace filename sanitizer removes traversal separators and rejects control characters", () => {
  const traversal = sanitizeWorkspaceFilename("../../brief.md");
  assert.equal(traversal.includes("/"), false);
  assert.equal(traversal.includes("\\"), false);
  assert.equal(traversal.endsWith("brief.md"), true);
  assert.equal(sanitizeWorkspaceFilename("folder\\brief.md"), "folder-brief.md");
  assert.equal(sanitizeWorkspaceFilename("  research   notes.md  "), "research notes.md");
  assert.throws(
    () => sanitizeWorkspaceFilename("brief\u0000name.md"),
    (error: unknown) => error instanceof ChatError && error.code === "INVALID_TEXT",
  );
  assert.throws(
    () => sanitizeWorkspaceFilename("..."),
    (error: unknown) => error instanceof ChatError && error.code === "INVALID_FILE",
  );
});

test("workspace kinds and provenance match the migration's FORCE-RLS contract", async () => {
  const migration = await readFile("migrations/012_product_m2_workspace_os.sql", "utf8");
  for (const kind of WORKSPACE_ITEM_KINDS) assert.match(migration, new RegExp(`'${kind}'`, "u"));
  assert.match(migration, /ALTER TABLE odin_api\.workspace_files FORCE ROW LEVEL SECURITY/u);
  assert.match(migration, /owner_id=\(SELECT odin_api\.actor\(\)\)/u);
  assert.match(migration, /REVOKE ALL ON odin_api\.workspace_files FROM PUBLIC/u);
  assert.match(migration, /REVOKE ALL ON odin_api\.%I FROM PUBLIC/u);
  assert.match(
    migration,
    /FOREIGN KEY\(owner_id,conversation_id,item_id\)[\s\S]*REFERENCES odin_api\.workspace_files\(owner_id,conversation_id,item_id\)/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY\(owner_id,conversation_id,source_turn_id\)[\s\S]*REFERENCES odin_api\.turns\(owner_id,conversation_id,id\)/u,
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

test("Workspace OS client persists canonical layout and has bounded autosave recovery", async () => {
  const [client, css] = await Promise.all([
    readFile("web/workspace-os.js", "utf8"),
    readFile("web/product-m2.css", "utf8"),
  ]);
  assert.match(client, /\/layout/u);
  assert.match(client, /expectedVersion/u);
  assert.match(client, /STALE_DOCUMENT/u);
  assert.match(client, /Retrying…/u);
  assert.match(client, /attempt < 2/u);
  assert.match(client, /conflictDrafts/u);
  assert.match(client, /Restore my draft/u);
  assert.doesNotMatch(client, /localStorage/u);
  assert.match(client, /slice\(0, 12\)|openIds\.length > 12/u);
  assert.match(client, /"Recent", items\.slice\(0, 5\)/u);
  assert.match(css, /@media \(max-width: 980px\)/u);
  assert.match(css, /@media \(max-width: 700px\)/u);
  assert.match(css, /env\(safe-area-inset-bottom\)/u);
  assert.match(css, /prefers-reduced-motion/u);
});

test("HTML preview remains isolated from Odin origin authority", async () => {
  const [client, preview] = await Promise.all([
    readFile("web/workspace-os.js", "utf8"),
    readFile("src/chat/preview.ts", "utf8"),
  ]);
  assert.match(client, /iframe\.sandbox = "allow-scripts"/u);
  assert.doesNotMatch(client, /allow-same-origin/u);
  assert.match(preview, /connect-src 'none'/u);
  assert.match(preview, /object-src 'none'/u);
  assert.match(preview, /base-uri 'none'/u);
  assert.match(preview, /form-action 'none'/u);
  assert.match(preview, /frame-ancestors 'self'/u);
});

test("Workspace mutation API keeps owner, origin and provenance out of client-controlled fields", async () => {
  const api = await readFile("src/chat/workspace-api.ts", "utf8");
  assert.match(api, /req\.headers\["x-odin-request"\] !== "1"/u);
  assert.match(api, /CSRF_DENIED/u);
  assert.doesNotMatch(api, /\["title", "content", "format", "ownerId"\]/u);
  assert.doesNotMatch(api, /\["title", "content", "format", "userId"\]/u);
  assert.doesNotMatch(api, /\["title", "content", "format", "origin"\]/u);
  assert.doesNotMatch(api, /\["turnId", "title", "sourceRunId"\]/u);
  assert.doesNotMatch(api, /verificationStatus/u);
});
