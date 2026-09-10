from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, found {count}")
    target.write_text(text.replace(old, new, 1))


# The persisted autonomy level must constrain actual tool access, not merely approval metadata.
replace_once(
    "src/bot/executor.ts",
    '''    const botIdentity = await bot.ensureDefaultBot();
    const teamPlan = planBotTeam(objective, task.mode, limits.maxParallelTasks);''',
    '''    const botIdentity = await bot.ensureDefaultBot();
    const readToolsAllowed = botIdentity.autonomyLevel >= 1;
    const workspaceWritesAllowed = botIdentity.autonomyLevel >= 3;
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

# Add a regression test that locks policy semantics to the runtime source.
path = Path("test/bot/team-autonomy-continuity.test.ts")
text = path.read_text()
needle = '''test("M5 level 3 only autonomously executes reversible low-risk effects", () => {'''
if text.count(needle) != 1:
    raise SystemExit("test anchor mismatch")
insert = '''test("M5 runtime enforces persisted autonomy on tool and workspace access", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../../src/bot/executor.ts", import.meta.url), "utf8"),
  );
  assert.match(source, /readToolsAllowed = botIdentity\.autonomyLevel >= 1/u);
  assert.match(source, /workspaceWritesAllowed = botIdentity\.autonomyLevel >= 3/u);
  assert.match(source, /requestedWorkspaceWrites && workspaceWritesAllowed/u);
  assert.match(source, /readToolsAllowed \? \{ research:/u);
});

'''
path.write_text(text.replace(needle, insert + needle, 1))
