import assert from "node:assert/strict";
import test from "node:test";
import { BotControlStore } from "../../src/bot/control-store.js";
import type { ActorDatabase, DatabaseAction } from "../../src/chat/neon-database.js";

interface CapturedQuery {
  readonly sql: string;
  readonly values: readonly unknown[];
}

class CaptureDatabase implements ActorDatabase {
  readonly calls: CapturedQuery[] = [];
  readonly taskId = "d2ce4d52-980a-47b7-825c-b91542b9456b";

  async transaction<T>(action: DatabaseAction<T>): Promise<T> {
    return action({
      query: (async (text: unknown, values?: readonly unknown[]) => {
        const sql = String(text);
        this.calls.push({ sql, values: values ?? [] });
        const row = {
          task_id: this.taskId,
          primary_objective: "Ship the durable worker",
          definition_of_done: ["Done"],
          constraints: [],
          current_plan: ["Inspect", "Repair"],
          completed_steps: ["Inspect"],
          open_blockers: [],
          team_plan: { version: 1 },
          drift_count: 0,
          revision: 1,
          updated_at: new Date().toISOString(),
        };
        return { rows: [row], rowCount: 1 };
      }) as never,
    });
  }
}

test("focus creation serializes JSONB arrays and team plan explicitly", async () => {
  const db = new CaptureDatabase();
  const store = new BotControlStore(db);

  await store.ensureFocus(db.taskId, "Ship the durable worker", { version: 1 });

  const insert = db.calls.find((call) => call.sql.includes("INSERT INTO odin_api.bot_focus"));
  assert.ok(insert);
  assert.match(insert.sql, /\$3::jsonb/u);
  assert.match(insert.sql, /\$4::jsonb/u);
  assert.equal(typeof insert.values[2], "string");
  assert.ok(Array.isArray(JSON.parse(String(insert.values[2]))));
  assert.deepEqual(JSON.parse(String(insert.values[3])), { version: 1 });
});

test("focus checkpoints serialize optional string arrays as JSONB", async () => {
  const db = new CaptureDatabase();
  const store = new BotControlStore(db);

  await store.checkpointFocus(db.taskId, {
    currentObjective: "Ship the durable worker",
    currentPlan: ["Inspect", "Repair"],
    completedSteps: ["Inspect"],
    openBlockers: [],
  });

  const update = db.calls.find((call) => call.sql.includes("current_plan=COALESCE"));
  assert.ok(update);
  assert.match(update.sql, /\$2::jsonb/u);
  assert.match(update.sql, /\$3::jsonb/u);
  assert.match(update.sql, /\$4::jsonb/u);
  assert.deepEqual(JSON.parse(String(update.values[1])), ["Inspect", "Repair"]);
  assert.deepEqual(JSON.parse(String(update.values[2])), ["Inspect"]);
  assert.deepEqual(JSON.parse(String(update.values[3])), []);
});
