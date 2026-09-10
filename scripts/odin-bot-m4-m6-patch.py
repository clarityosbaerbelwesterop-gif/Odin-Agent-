from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, found {count}")
    target.write_text(text.replace(old, new, 1))


# M4: primary preserves the user's requested mode; independent reviewer emits a machine-readable verdict.
replace_once(
    "src/bot/team.ts",
    "      mode: definition.defaultMode,",
    '      mode: phase === "primary" ? mode : definition.defaultMode,',
)
replace_once(
    "src/bot/team.ts",
    '''  const writeRule = assignment.mayWriteWorkspace
    ? "You are the single authorized workspace writer for this phase. Stage changes, test, repair, and verify before claiming success."
    : "You are read-only for this phase. Do not modify files, create commits, merge, change secrets, spend money, or perform irreversible actions.";
  const supplied = context.trim() ?''',
    '''  const writeRule = assignment.mayWriteWorkspace
    ? "You are the single authorized workspace writer for this phase. Stage changes, test, repair, and verify before claiming success."
    : "You are read-only for this phase. Do not modify files, create commits, merge, change secrets, spend money, or perform irreversible actions.";
  const reviewRule = assignment.phase === "review"
    ? "Your first output line MUST be exactly VERDICT: PASS when the result is sufficiently verified, or VERDICT: BLOCK when a concrete correctness, security, scope, or release blocker remains. Never pass an unproven claim."
    : "";
  const supplied = context.trim() ?''',
)
replace_once(
    "src/bot/team.ts",
    '''    writeRule,
    "Stay inside the user's primary objective.''',
    '''    writeRule,
    reviewRule,
    "Stay inside the user's primary objective.''',
)

# M6: persist mission continuity after verified completion.
replace_once(
    "src/bot/executor.ts",
    '''    const teamPlan = planBotTeam(objective, task.mode, limits.maxParallelTasks);
    await control.ensureFocus''',
    '''    const botIdentity = await bot.ensureDefaultBot();
    const teamPlan = planBotTeam(objective, task.mode, limits.maxParallelTasks);
    await control.ensureFocus''',
)
replace_once(
    "src/bot/executor.ts",
    '''      await bot.updateTask(task.id, "done", "Completed and independently checked", "runtime.completed", {
        turnId,
        teamPlanHash: teamPlan.planHash,
      });
      return "done";''',
    '''      await control.remember(botIdentity.id, {
        kind: "previous_mission",
        key: `mission:${task.id}`,
        content: JSON.stringify({
          objective,
          taskId: task.id,
          conversationId,
          turnId,
          teamPlanHash: teamPlan.planHash,
        }),
        sourceClass: "mission",
        sourceRef: `bot-task:${task.id}`,
        sourceTimestamp: new Date().toISOString(),
        scope: { taskId: task.id },
        confidence: 1,
        sensitivity: "internal",
      });
      await bot.updateTask(task.id, "done", "Completed and independently checked", "runtime.completed", {
        turnId,
        teamPlanHash: teamPlan.planHash,
      });
      return "done";''',
)

# API wiring: server-side autonomy, exact approvals, team catalog, memory and focus detail.
replace_once(
    "src/chat/hosted.ts",
    'import { botPlanLimits } from "../bot/entitlements.js";',
    'import { BotControlStore } from "../bot/control-store.js";\nimport { botPlanLimits } from "../bot/entitlements.js";',
)
replace_once(
    "src/chat/hosted.ts",
    'import { BotStore } from "../bot/store.js";',
    'import { BotStore } from "../bot/store.js";\nimport { botSpecialists } from "../bot/team.js";',
)
replace_once(
    "src/chat/hosted.ts",
    '''    const store = new NeonChatStore(db);
    const botStore = new BotStore(db);''',
    '''    const store = new NeonChatStore(db);
    const botStore = new BotStore(db);
    const botControl = new BotControlStore(db);''',
)
replace_once(
    "src/chat/hosted.ts",
    '''        bot: await botStore.ensureDefaultBot(),
        tasks: await botStore.tasks(),
        automations: await botStore.automations(),
        inbox: await botStore.inbox(),
        limits,''',
    '''        bot: await botStore.ensureDefaultBot(),
        tasks: await botStore.tasks(),
        automations: await botStore.automations(),
        approvals: await botControl.approvals(),
        inbox: await botStore.inbox(),
        team: botSpecialists(),
        limits,''',
)
insert_anchor = '''    if (url.pathname === "/api/bot/tasks" && method === "POST") {'''
insert_routes = '''    if (url.pathname === "/api/bot/settings" && method === "POST") {
      await botAccess();
      const body = object(await jsonBody(req), ["autonomyLevel"]);
      const level = Number(body.autonomyLevel);
      if (!Number.isInteger(level) || level < 0 || level > 4)
        throw new ChatError("INVALID_AUTONOMY", "Choose autonomy level 0 through 4.");
      const bot = await botStore.ensureDefaultBot();
      send(res, 200, {
        autonomyLevel: await botControl.setBotAutonomy(bot.id, level as 0 | 1 | 2 | 3 | 4),
      });
      return;
    }
    if (url.pathname === "/api/bot/approvals" && method === "GET") {
      await botAccess();
      send(res, 200, { approvals: await botControl.approvals() });
      return;
    }
    const botApprovalRoute = /^\\/api\\/bot\\/approvals\\/([\\w-]+)$/u.exec(url.pathname);
    if (botApprovalRoute && method === "POST") {
      await botAccess();
      const body = object(await jsonBody(req), ["decision", "actionHash"]);
      if (body.decision !== "approve" && body.decision !== "reject")
        throw new ChatError("INVALID_APPROVAL_DECISION", "Choose approve or reject.");
      send(res, 200, {
        approval: await botControl.decideApproval(
          identifier(botApprovalRoute[1]),
          body.decision,
          typeof body.actionHash === "string" ? body.actionHash : undefined,
        ),
      });
      return;
    }
    if (url.pathname === "/api/bot/memory") {
      await botAccess();
      const bot = await botStore.ensureDefaultBot();
      if (method === "GET") {
        send(res, 200, { memories: await botControl.memories(bot.id) });
        return;
      }
      if (method === "POST") {
        const body = object(await jsonBody(req), [
          "kind", "key", "content", "sourceRef", "scope", "confidence", "sensitivity", "expiresAt",
        ]);
        const kinds = new Set([
          "user_preference", "project", "recurring_task", "decision", "working_context", "previous_mission", "learned_procedure",
        ]);
        const sensitivities = new Set(["public", "internal", "sensitive"]);
        if (!kinds.has(String(body.kind)) || !sensitivities.has(String(body.sensitivity ?? "internal")))
          throw new ChatError("INVALID_MEMORY", "Choose a supported memory kind and sensitivity.");
        send(res, 201, await botControl.remember(bot.id, {
          kind: String(body.kind) as "user_preference" | "project" | "recurring_task" | "decision" | "working_context" | "previous_mission" | "learned_procedure",
          key: typeof body.key === "string" ? body.key : "",
          content: typeof body.content === "string" ? body.content : "",
          sourceClass: "explicit_user",
          sourceRef: typeof body.sourceRef === "string" ? body.sourceRef : "user:bot-memory",
          sourceTimestamp: new Date().toISOString(),
          scope: body.scope && typeof body.scope === "object" && !Array.isArray(body.scope) ? body.scope as Record<string, unknown> : {},
          confidence: typeof body.confidence === "number" ? body.confidence : 1,
          sensitivity: String(body.sensitivity ?? "internal") as "public" | "internal" | "sensitive",
          expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
        }));
        return;
      }
    }
'''
replace_once("src/chat/hosted.ts", insert_anchor, insert_routes + insert_anchor)
replace_once(
    "src/chat/hosted.ts",
    '''          task: await botStore.task(taskId),
          events: await botStore.events(taskId),
        });''',
    '''          task: await botStore.task(taskId),
          events: await botStore.events(taskId),
          focus: await botControl.focus(taskId).catch(() => null),
        });''',
)

# Production migration pipeline applies M4-M6 additively after the M1-M3 schema.
replace_once(
    "scripts/sync-vercel-production.mjs",
    '''    await pool.query(botMigration);
    report.checks.push("Odin Bot M1-M3 additive schema reconciled");

    const role =''',
    '''    await pool.query(botMigration);
    report.checks.push("Odin Bot M1-M3 additive schema reconciled");
    const botControlMigration = await readFile(
      new URL("../migrations/007_odin_bot_m4_m6.sql", import.meta.url),
      "utf8",
    );
    await pool.query(botControlMigration);
    report.checks.push("Odin Bot M4-M6 autonomy/memory/focus schema reconciled");

    const role =''',
)

# Production verification now requires every user-owned M4-M6 table to be FORCE RLS isolated.
replace_once(
    "scripts/verify-neon-production.mjs",
    '    assert(tables.rows.length >= 23, "ODIN_TABLE_COUNT");',
    '    assert(tables.rows.length >= 26, "ODIN_TABLE_COUNT");',
)
replace_once(
    "scripts/verify-neon-production.mjs",
    '''    const botTables = new Set(["bots", "bot_tasks", "bot_task_events", "bot_automations", "bot_inbox"]);''',
    '''    const botTables = new Set([
      "bots",
      "bot_tasks",
      "bot_task_events",
      "bot_automations",
      "bot_inbox",
      "bot_approvals",
      "bot_memories",
      "bot_focus",
    ]);''',
)
