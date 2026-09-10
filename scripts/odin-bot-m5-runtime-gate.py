from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, found {count}")
    target.write_text(text.replace(old, new, 1))


# M5 runtime policy: persisted autonomy controls real tool/write authority.
replace_once(
    "src/bot/autonomy.ts",
    '''export function hashAction(action: BotActionRequest): string {''',
    '''export function botRuntimeAccess(level: number): {
  readonly readToolsAllowed: boolean;
  readonly workspaceWritesAllowed: boolean;
} {
  validateLevel(level);
  return {
    readToolsAllowed: level >= 1,
    workspaceWritesAllowed: level >= 3,
  };
}

export function hashAction(action: BotActionRequest): string {''',
)
replace_once(
    "src/bot/executor.ts",
    '''import { BotControlStore } from "./control-store.js";''',
    '''import { botRuntimeAccess } from "./autonomy.js";
import { BotControlStore } from "./control-store.js";''',
)
replace_once(
    "src/bot/executor.ts",
    '''import { type BotTeamAssignment, type BotTeamPlan, planBotTeam, specialistPrompt } from "./team.js";''',
    '''import { type BotTeamAssignment, planBotTeam, specialistPrompt } from "./team.js";''',
)
replace_once(
    "src/bot/executor.ts",
    '''    const botIdentity = await bot.ensureDefaultBot();
    const teamPlan = planBotTeam(objective, task.mode, limits.maxParallelTasks);''',
    '''    const botIdentity = await bot.ensureDefaultBot();
    const { readToolsAllowed, workspaceWritesAllowed } = botRuntimeAccess(
      botIdentity.autonomyLevel,
    );
    const teamPlan = planBotTeam(objective, task.mode, limits.maxParallelTasks);''',
)
replace_once(
    "src/bot/executor.ts",
    '''    const makeEngine = (id: string, allowWorkspaceWrites: boolean) => {
      const quality = githubReady
        ? new GitHubWorkspace(
            githubToken as string,
            githubConnection.repository as string,
            githubConnection.defaultBranch as string,
            async () => {},
          )
        : new NeonWorkspace(db, id, async () => {});
      return new ChatEngine({''',
    '''    const makeEngine = (id: string, requestedWorkspaceWrites: boolean) => {
      const allowWorkspaceWrites = requestedWorkspaceWrites && workspaceWritesAllowed;
      const quality = readToolsAllowed
        ? githubReady
          ? new GitHubWorkspace(
              githubToken as string,
              githubConnection.repository as string,
              githubConnection.defaultBranch as string,
              async () => {},
            )
          : new NeonWorkspace(db, id, async () => {})
        : undefined;
      return new ChatEngine({''',
)
replace_once(
    "src/bot/executor.ts",
    '''        allowWorkspaceWrites,
        quality,
        workspace: (changed) =>
          githubReady
            ? new GitHubWorkspace(
                githubToken as string,
                githubConnection.repository as string,
                githubConnection.defaultBranch as string,
                changed,
              )
            : new NeonWorkspace(db, id, changed),
        research: new WikipediaResearchAdapter("de"),
      });''',
    '''        allowWorkspaceWrites,
        ...(quality
          ? {
              quality,
              workspace: (changed) =>
                githubReady
                  ? new GitHubWorkspace(
                      githubToken as string,
                      githubConnection.repository as string,
                      githubConnection.defaultBranch as string,
                      changed,
                    )
                  : new NeonWorkspace(db, id, changed),
            }
          : {}),
        ...(readToolsAllowed ? { research: new WikipediaResearchAdapter("de") } : {}),
      });''',
)
replace_once(
    "src/bot/executor.ts",
    '''        mayWriteWorkspace: assignment.mayWriteWorkspace,
      })),
    });''',
    '''        mayWriteWorkspace: assignment.mayWriteWorkspace,
        effectiveMayWriteWorkspace: assignment.mayWriteWorkspace && workspaceWritesAllowed,
      })),
      autonomyLevel: botIdentity.autonomyLevel,
      readToolsAllowed,
      workspaceWritesAllowed,
    });''',
)

# Behavioral regression test: no source-file path assumptions after TypeScript compilation.
replace_once(
    "test/bot/team-autonomy-continuity.test.ts",
    '''import { assessBotAction } from "../../src/bot/autonomy.js";''',
    '''import { assessBotAction, botRuntimeAccess } from "../../src/bot/autonomy.js";''',
)
needle = '''test("M5 level 3 only autonomously executes reversible low-risk effects", () => {'''
path = Path("test/bot/team-autonomy-continuity.test.ts")
text = path.read_text()
if text.count(needle) != 1:
    raise SystemExit("test anchor mismatch")
insert = '''test("M5 runtime access follows persisted autonomy level", () => {
  assert.deepEqual(botRuntimeAccess(0), {
    readToolsAllowed: false,
    workspaceWritesAllowed: false,
  });
  assert.deepEqual(botRuntimeAccess(1), {
    readToolsAllowed: true,
    workspaceWritesAllowed: false,
  });
  assert.deepEqual(botRuntimeAccess(2), {
    readToolsAllowed: true,
    workspaceWritesAllowed: false,
  });
  assert.deepEqual(botRuntimeAccess(3), {
    readToolsAllowed: true,
    workspaceWritesAllowed: true,
  });
  assert.deepEqual(botRuntimeAccess(4), {
    readToolsAllowed: true,
    workspaceWritesAllowed: true,
  });
  assert.throws(() => botRuntimeAccess(5), /Autonomy level/u);
});

'''
path.write_text(text.replace(needle, insert + needle, 1))
