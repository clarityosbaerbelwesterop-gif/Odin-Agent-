from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise SystemExit(f"missing expected block in {path}: {old[:100]!r}")
    target.write_text(text.replace(old, new, 1))


replace(
    "src/chat/agent.ts",
    '''    await save();
    return { text, verified: verification.outcome === "PASS", checkpoint: state };''',
    '''    await save();

    // A steering event may arrive while final quality or verification is still running.
    // Recheck the durable event stream before completion so efficiency optimizations never
    // let a stale draft win against the user's newest instruction.
    let completionCursor = state.steeringCursor;
    let lateSteering = false;
    while (true) {
      const events = await store.events(turn.conversationId, completionCursor, 1000);
      for (const event of events) {
        if (event.turnId === turn.id && event.type === "steering") {
          lateSteering = true;
          state = { ...state, reviewed: false };
          await add({ role: "user", content: [{ type: "text", text: String(event.data.text) }] });
        }
      }
      completionCursor = events.at(-1)?.cursor ?? completionCursor;
      if (events.length < 1000) break;
    }
    state = { ...state, steeringCursor: completionCursor };
    await save();
    if (lateSteering) {
      await publish("activity", {
        phase: "steering",
        message: "New instruction received before completion; updating the result",
      });
      continue;
    }
    return { text, verified: verification.outcome === "PASS", checkpoint: state };''',
)

path = Path("test/chat/product-experience.test.ts")
text = path.read_text()
text = text.replace('const root = new URL("../../", import.meta.url);', 'const root = process.cwd();')
text = text.replace(
    'const source = await readFile(new URL("scripts/configure-vercel-production.mjs", root), "utf8");',
    'const source = await readFile(`${root}/scripts/configure-vercel-production.mjs`, "utf8");',
)
text = text.replace(
    'const source = await readFile(new URL("src/chat/agent.ts", root), "utf8");',
    'const source = await readFile(`${root}/src/chat/agent.ts`, "utf8");',
)
path.write_text(text)
