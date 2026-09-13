import assert from "node:assert/strict";
import test from "node:test";
import type { ActorDatabase } from "../../src/chat/neon-database.js";
import { SkillProductStore } from "../../src/chat/skill-product-store.js";
import type { ProductSkillInstallation, ProductSkillScope } from "../../src/chat/skills-product.js";
import { ChatError } from "../../src/chat/types.js";

type InstallationRow = {
  installation_id: string;
  skill_id: string;
  version: string;
  content_hash: string;
  scope: ProductSkillScope;
  project_id: string | null;
  enabled: boolean;
  previous_version: string | null;
  previous_content_hash: string | null;
  installed_at: string;
  updated_at: string;
};

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const hashV1 = "1".repeat(64);
const hashV2 = "2".repeat(64);

function key(skillId: string, scope: ProductSkillScope, project: string | null): string {
  return `${skillId}:${scope}:${project ?? "global"}`;
}

class LifecycleDb {
  readonly rows = new Map<string, InstallationRow>();
  readonly projects = new Set([projectId]);
  readonly runs = new Map([[runId, projectId]]);
  github = true;
  serial = 0;

  readonly actorDb = {
    transaction: async <T>(action: Parameters<ActorDatabase["transaction"]>[0]): Promise<T> =>
      action({ query: this.query } as never) as Promise<T>,
  } as unknown as ActorDatabase;

  readonly query = async (text: string, values: readonly unknown[] = []) => {
    const sql = text.replace(/\s+/gu, " ").trim();

    if (sql.startsWith("SELECT 1 FROM odin_api.conversations")) {
      return { rows: this.projects.has(String(values[0])) ? [{ ok: true }] : [] };
    }
    if (sql.startsWith("SELECT 1 FROM odin_api.turns")) {
      return {
        rows: this.runs.get(String(values[0])) === String(values[1]) ? [{ ok: true }] : [],
      };
    }
    if (sql.startsWith("SELECT repository,default_branch FROM odin_api.github_connections")) {
      return {
        rows: this.github
          ? [{ repository: "clarityosbaerbelwesterop-gif/Odin-Agent-", default_branch: "main" }]
          : [],
      };
    }
    if (sql.startsWith("SELECT installation_id") && sql.includes("FROM odin_api.skill_installations")) {
      if (sql.includes("WHERE skill_id=$1")) {
        const found = this.rows.get(
          key(
            String(values[0]),
            String(values[1]) as ProductSkillScope,
            values[2] === null ? null : String(values[2]),
          ),
        );
        return { rows: found ? [{ ...found }] : [] };
      }
      const requestedProject = values[0] === null ? null : String(values[0]);
      return {
        rows: [...this.rows.values()]
          .filter(
            (row) =>
              row.scope === "global" ||
              (requestedProject !== null &&
                row.scope === "project" &&
                row.project_id === requestedProject),
          )
          .map((row) => ({ ...row })),
      };
    }
    if (sql.startsWith("INSERT INTO odin_api.skill_installations")) {
      this.serial += 1;
      const row: InstallationRow = {
        installation_id: `00000000-0000-4000-8000-${String(this.serial).padStart(12, "0")}`,
        skill_id: String(values[0]),
        version: String(values[1]),
        content_hash: String(values[2]),
        scope: String(values[3]) as ProductSkillScope,
        project_id: values[4] === null ? null : String(values[4]),
        enabled: true,
        previous_version: null,
        previous_content_hash: null,
        installed_at: "2026-09-13T10:00:00.000Z",
        updated_at: "2026-09-13T10:00:00.000Z",
      };
      this.rows.set(key(row.skill_id, row.scope, row.project_id), row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE odin_api.skill_installations SET enabled=$4")) {
      const row = this.rows.get(
        key(
          String(values[0]),
          String(values[1]) as ProductSkillScope,
          values[2] === null ? null : String(values[2]),
        ),
      );
      if (!row) return { rows: [], rowCount: 0 };
      row.enabled = Boolean(values[3]);
      row.updated_at = "2026-09-13T10:01:00.000Z";
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE odin_api.skill_installations SET previous_version=version")) {
      const row = this.rows.get(
        key(
          String(values[0]),
          String(values[1]) as ProductSkillScope,
          values[2] === null ? null : String(values[2]),
        ),
      );
      if (!row || row.content_hash !== String(values[5])) return { rows: [], rowCount: 0 };
      row.previous_version = row.version;
      row.previous_content_hash = row.content_hash;
      row.version = String(values[3]);
      row.content_hash = String(values[4]);
      row.updated_at = "2026-09-13T10:02:00.000Z";
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE odin_api.skill_installations SET version=previous_version")) {
      const row = [...this.rows.values()].find(
        (candidate) => candidate.installation_id === String(values[0]),
      );
      if (!row || !row.previous_version || !row.previous_content_hash)
        return { rows: [], rowCount: 0 };
      const nextVersion = row.previous_version;
      const nextHash = row.previous_content_hash;
      row.previous_version = String(values[1]);
      row.previous_content_hash = String(values[2]);
      row.version = nextVersion;
      row.content_hash = nextHash;
      row.updated_at = "2026-09-13T10:03:00.000Z";
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.startsWith("DELETE FROM odin_api.skill_installations")) {
      const rowKey = key(
        String(values[0]),
        String(values[1]) as ProductSkillScope,
        values[2] === null ? null : String(values[2]),
      );
      const deleted = this.rows.delete(rowKey);
      return { rows: [], rowCount: deleted ? 1 : 0 };
    }

    throw new Error(`Unexpected PRODUCT M5 lifecycle SQL: ${sql}`);
  };
}

function code(error: unknown): string | undefined {
  return error instanceof ChatError ? error.code : undefined;
}

function assertInstallation(
  value: ProductSkillInstallation,
  expected: { version: string; contentHash: string; previousVersion: string | null; previousHash: string | null },
): void {
  assert.equal(value.version, expected.version);
  assert.equal(value.contentHash, expected.contentHash);
  assert.equal(value.previousVersion, expected.previousVersion);
  assert.equal(value.previousContentHash, expected.previousHash);
}

test("PRODUCT M5 store install → update → rollback restores the exact previous version and hash atomically", async () => {
  const db = new LifecycleDb();
  const store = new SkillProductStore(db.actorDb);

  const installed = await store.install({
    skillId: "product-planning",
    version: "1.0.0",
    contentHash: hashV1,
    scope: "project",
    projectId,
  });
  assertInstallation(installed, {
    version: "1.0.0",
    contentHash: hashV1,
    previousVersion: null,
    previousHash: null,
  });

  const updated = await store.update({
    skillId: "product-planning",
    version: "2.0.0",
    contentHash: hashV2,
    scope: "project",
    projectId,
    expectedContentHash: hashV1,
  });
  assertInstallation(updated, {
    version: "2.0.0",
    contentHash: hashV2,
    previousVersion: "1.0.0",
    previousHash: hashV1,
  });

  const rolledBack = await store.rollback(
    "product-planning",
    "project",
    projectId,
    hashV2,
  );
  assertInstallation(rolledBack, {
    version: "1.0.0",
    contentHash: hashV1,
    previousVersion: "2.0.0",
    previousHash: hashV2,
  });
});

test("PRODUCT M5 optimistic hash checks reject tampered update and rollback without partial mutation", async () => {
  const db = new LifecycleDb();
  const store = new SkillProductStore(db.actorDb);
  await store.install({
    skillId: "product-planning",
    version: "1.0.0",
    contentHash: hashV1,
    scope: "project",
    projectId,
  });

  await assert.rejects(
    () =>
      store.update({
        skillId: "product-planning",
        version: "2.0.0",
        contentHash: hashV2,
        scope: "project",
        projectId,
        expectedContentHash: "f".repeat(64),
      }),
    (error) => code(error) === "SKILL_INTEGRITY",
  );
  const unchanged = await store.installation("product-planning", "project", projectId);
  assert.ok(unchanged);
  assertInstallation(unchanged, {
    version: "1.0.0",
    contentHash: hashV1,
    previousVersion: null,
    previousHash: null,
  });

  await assert.rejects(
    () => store.rollback("product-planning", "project", projectId, "e".repeat(64)),
    (error) => code(error) === "SKILL_INTEGRITY",
  );
  const stillUnchanged = await store.installation("product-planning", "project", projectId);
  assert.ok(stillUnchanged);
  assert.equal(stillUnchanged.contentHash, hashV1);
});

test("PRODUCT M5 enable/disable/remove lifecycle mutates only the requested scoped installation", async () => {
  const db = new LifecycleDb();
  const store = new SkillProductStore(db.actorDb);
  await store.install({
    skillId: "product-planning",
    version: "1.0.0",
    contentHash: hashV1,
    scope: "global",
    projectId: null,
  });
  await store.install({
    skillId: "product-planning",
    version: "1.0.0",
    contentHash: hashV1,
    scope: "project",
    projectId,
  });

  const disabled = await store.setEnabled("product-planning", "project", projectId, false);
  assert.equal(disabled.enabled, false);
  const global = await store.installation("product-planning", "global", null);
  assert.equal(global?.enabled, true);

  const enabled = await store.setEnabled("product-planning", "project", projectId, true);
  assert.equal(enabled.enabled, true);
  await store.remove("product-planning", "project", projectId);
  assert.equal(await store.installation("product-planning", "project", projectId), undefined);
  assert.ok(await store.installation("product-planning", "global", null));
});

test("PRODUCT M5 store binds Project and Run lookup to canonical actor-scoped authorities", async () => {
  const db = new LifecycleDb();
  const store = new SkillProductStore(db.actorDb);

  await store.requireProject(projectId);
  await store.requireRunProject(projectId, runId);
  await assert.rejects(
    () => store.requireProject("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    (error) => code(error) === "NOT_FOUND",
  );
  await assert.rejects(
    () => store.requireRunProject("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", runId),
    (error) => code(error) === "RUN_PROJECT_MISMATCH",
  );
});

test("PRODUCT M5 connection state is server-side and requires a selected GitHub repository", async () => {
  const db = new LifecycleDb();
  const store = new SkillProductStore(db.actorDb);
  assert.deepEqual(await store.connections(), { github: true });
  db.github = false;
  assert.deepEqual(await store.connections(), { github: false });
});
