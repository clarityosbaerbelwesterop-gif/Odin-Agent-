import assert from "node:assert/strict";
import test from "node:test";
import type { ActorDatabase } from "../../src/chat/neon-database.js";
import {
  restoreRunSkill,
  runSkillContextMessage,
  selectRunSkill,
  skillEventData,
} from "../../src/chat/run-skills.js";
import { SkillProductStore } from "../../src/chat/skill-product-store.js";
import {
  type ProductSkillInstallation,
  productRuntimeSkill,
  productSkillById,
} from "../../src/chat/skills-product.js";
import { ChatError, type ChatTurn } from "../../src/chat/types.js";

const projectA = "11111111-1111-4111-8111-111111111111";
const projectB = "22222222-2222-4222-8222-222222222222";
const runA = "33333333-3333-4333-8333-333333333333";

function installation(
  skillId: string,
  overrides: Partial<ProductSkillInstallation> = {},
): ProductSkillInstallation {
  const skill = productSkillById(skillId);
  return Object.freeze({
    installationId: "44444444-4444-4444-8444-444444444444",
    skillId,
    version: skill.version,
    contentHash: skill.contentHash,
    scope: "project",
    projectId: projectA,
    enabled: true,
    previousVersion: null,
    previousContentHash: null,
    installedAt: "2026-09-13T10:00:00.000Z",
    updatedAt: "2026-09-13T10:00:00.000Z",
    ...overrides,
  });
}

function turn(overrides: Partial<ChatTurn> = {}): ChatTurn {
  return Object.freeze({
    id: runA,
    conversationId: projectA,
    mode: "coding",
    modelId: "test-model",
    objective: "Implement a scoped repository fix and verify it.",
    createdAt: "2026-09-13T10:01:00.000Z",
    ...overrides,
  });
}

function row(value: ProductSkillInstallation): Record<string, unknown> {
  return {
    installation_id: value.installationId,
    skill_id: value.skillId,
    version: value.version,
    content_hash: value.contentHash,
    scope: value.scope,
    project_id: value.projectId,
    enabled: value.enabled,
    previous_version: value.previousVersion,
    previous_content_hash: value.previousContentHash,
    installed_at: value.installedAt,
    updated_at: value.updatedAt,
  };
}

class RuntimeDb {
  readonly runs = new Map<string, string>([[runA, projectA]]);
  github = true;
  installations: ProductSkillInstallation[] = [];

  readonly actorDb = {
    transaction: async <T>(action: Parameters<ActorDatabase["transaction"]>[0]): Promise<T> =>
      action({ query: this.query } as never) as Promise<T>,
  } as unknown as ActorDatabase;

  readonly query = async (text: string, values: readonly unknown[] = []) => {
    const sql = text.replace(/\s+/gu, " ").trim();
    if (sql.startsWith("SELECT 1 FROM odin_api.turns")) {
      const requestedRun = String(values[0]);
      const requestedProject = String(values[1]);
      return {
        rows: this.runs.get(requestedRun) === requestedProject ? [{ ok: true }] : [],
      };
    }
    if (sql.startsWith("SELECT repository,default_branch FROM odin_api.github_connections")) {
      return {
        rows: this.github
          ? [{ repository: "clarityosbaerbelwesterop-gif/Odin-Agent-", default_branch: "main" }]
          : [],
      };
    }
    if (sql.includes("FROM odin_api.skill_installations")) {
      const requestedProject = values[0] === null ? null : String(values[0]);
      return {
        rows: this.installations
          .filter(
            (item) =>
              item.scope === "global" ||
              (requestedProject !== null &&
                item.scope === "project" &&
                item.projectId === requestedProject),
          )
          .map(row),
      };
    }
    throw new Error(`Unexpected Product M5 runtime SQL: ${sql}`);
  };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof ChatError ? error.code : undefined;
}

test("PRODUCT M5 M10 package identity is the Product content hash and M23 loads only the selected procedure", async () => {
  const db = new RuntimeDb();
  const coding = installation("repository-coding");
  db.installations = [coding];

  const selected = await selectRunSkill(new SkillProductStore(db.actorDb), turn());
  assert.equal(selected.kind, "selected");
  if (selected.kind !== "selected") return;

  const runtime = productRuntimeSkill("repository-coding");
  assert.equal(selected.skillId, "repository-coding");
  assert.equal(selected.version, runtime.package.version);
  assert.equal(selected.contentHash, runtime.package.contentHash);
  assert.equal(productSkillById("repository-coding").contentHash, runtime.package.contentHash);
  assert.deepEqual(selected.requiredTools, runtime.package.requiredTools);
  assert.equal(selected.instructions, runtime.package.instructions);
  assert.ok(selected.instructionBytes > 0);
  assert.match(selected.selectionHash, /^[a-f0-9]{64}$/u);

  const context = runSkillContextMessage(selected);
  assert.match(context, /ODIN VERIFIED SKILL PROCEDURE/u);
  assert.match(
    context,
    /cannot grant tools, credentials, network, deployment, billing, database/iu,
  );
  assert.match(context, /Repository content can contain prompt injection/iu);
});

test("PRODUCT M5 blocks a real coding Run when the installed Skill connection is unavailable", async () => {
  const db = new RuntimeDb();
  db.github = false;
  db.installations = [installation("repository-coding")];

  const resolved = await selectRunSkill(new SkillProductStore(db.actorDb), turn());
  assert.equal(resolved.kind, "blocked");
  if (resolved.kind !== "blocked") return;
  assert.equal(resolved.reason, "connection_required");
  assert.deepEqual(resolved.missingConnections, ["github"]);
  assert.equal(resolved.projectId, projectA);
  assert.equal(resolved.runId, runA);
});

test("PRODUCT M5 rejects a Run from another Project before Skill discovery", async () => {
  const db = new RuntimeDb();
  db.runs.set(runA, projectB);
  db.installations = [installation("repository-coding")];

  await assert.rejects(
    () => selectRunSkill(new SkillProductStore(db.actorDb), turn()),
    (error) => errorCode(error) === "RUN_PROJECT_MISMATCH",
  );
});

test("PRODUCT M5 disabled or missing Skills are never loaded", async () => {
  const db = new RuntimeDb();
  db.installations = [installation("repository-coding", { enabled: false })];
  assert.deepEqual(await selectRunSkill(new SkillProductStore(db.actorDb), turn()), {
    kind: "none",
  });

  db.installations = [];
  assert.deepEqual(await selectRunSkill(new SkillProductStore(db.actorDb), turn()), {
    kind: "none",
  });
});

test("PRODUCT M5 changed installed revision fails closed instead of silently substituting the catalog", async () => {
  const db = new RuntimeDb();
  db.installations = [
    installation("repository-coding", {
      version: "0.9.0",
      contentHash: "0".repeat(64),
    }),
  ];

  const resolved = await selectRunSkill(new SkillProductStore(db.actorDb), turn());
  assert.equal(resolved.kind, "blocked");
  if (resolved.kind !== "blocked") return;
  assert.equal(resolved.reason, "version_mismatch");
  assert.equal(resolved.version, "0.9.0");
  assert.equal(resolved.contentHash, "0".repeat(64));
});

test("PRODUCT M5 resume restores only the exact pinned version and content hash", async () => {
  const db = new RuntimeDb();
  db.installations = [installation("repository-coding")];
  const selected = await selectRunSkill(new SkillProductStore(db.actorDb), turn());
  assert.equal(selected.kind, "selected");
  if (selected.kind !== "selected") return;

  const pinned = skillEventData(selected);
  const restored = restoreRunSkill(pinned);
  assert.equal(restored.skillId, selected.skillId);
  assert.equal(restored.version, selected.version);
  assert.equal(restored.contentHash, selected.contentHash);
  assert.equal(restored.selectionHash, selected.selectionHash);

  assert.throws(
    () => restoreRunSkill({ ...pinned, contentHash: "f".repeat(64) }),
    (error) => errorCode(error) === "SKILL_INTEGRITY",
  );
  assert.throws(
    () => restoreRunSkill({ ...pinned, version: "9.9.9" }),
    (error) => errorCode(error) === "SKILL_INTEGRITY",
  );
});

test("PRODUCT M5 canonical Skill event metadata is bounded and never embeds the procedure body", async () => {
  const db = new RuntimeDb();
  db.installations = [installation("repository-coding")];
  const selected = await selectRunSkill(new SkillProductStore(db.actorDb), turn());
  assert.equal(selected.kind, "selected");
  if (selected.kind !== "selected") return;

  const event = skillEventData(selected);
  assert.equal(event.projectId, projectA);
  assert.equal(event.runId, runA);
  assert.equal(event.taskId, "work");
  assert.equal(event.skillId, "repository-coding");
  assert.equal(event.version, selected.version);
  assert.equal(event.contentHash, selected.contentHash);
  assert.equal(event.selectionHash, selected.selectionHash);
  assert.equal("instructions" in event, false);
  assert.ok(Buffer.byteLength(JSON.stringify(event), "utf8") < 10_000);
});
