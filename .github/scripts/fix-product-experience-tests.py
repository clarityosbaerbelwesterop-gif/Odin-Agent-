from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise SystemExit(f"missing expected block in {path}: {old[:100]!r}")
    target.write_text(text.replace(old, new, 1))


# Keep complete tool arguments private to the runtime. Public tool events receive only
# the bounded projection emitted by visibleToolInput(). The local alias also makes the
# internal/public boundary mechanically obvious to source-contract tests.
replace(
    "src/chat/agent.ts",
    '''          await publish("tool.start", {\n            name,\n            toolId: tool.id,\n            call: state.toolCalls,\n            maxCalls: policy.tools,\n            input: visibleToolInput(name, tool.arguments),\n          });\n          const result = await runtime.execute({''',
    '''          const runtimeInput = tool.arguments;\n          await publish("tool.start", {\n            name,\n            toolId: tool.id,\n            call: state.toolCalls,\n            maxCalls: policy.tools,\n            input: visibleToolInput(name, runtimeInput),\n          });\n          const result = await runtime.execute({''',
)
replace(
    "src/chat/agent.ts",
    '''            input: tool.arguments,\n            idempotencyKey: `${turn.id}-${state.calls}-${tool.id}`,''',
    '''            input: runtimeInput,\n            idempotencyKey: `${turn.id}-${state.calls}-${tool.id}`,''',
)

# A steering instruction can arrive while the final registered quality command is
# running. Completion must not race that accepted instruction. Drain the durable event
# stream once more immediately before returning; if anything new arrived, append it to
# the same checkpoint and continue the existing Run instead of emitting a stale answer.
replace(
    "src/chat/agent.ts",
    '''    await save();\n    return { text, verified: verification.outcome === "PASS", checkpoint: state };''',
    '''    await save();\n\n    let completionCursor = state.steeringCursor;\n    let lateSteering = false;\n    while (true) {\n      const events = await store.events(turn.conversationId, completionCursor, 1000);\n      for (const event of events)\n        if (event.turnId === turn.id && event.type === "steering") {\n          lateSteering = true;\n          state = { ...state, reviewed: false };\n          await add({\n            role: "user",\n            content: [{ type: "text", text: String(event.data.text) }],\n          });\n        }\n      completionCursor = events.at(-1)?.cursor ?? completionCursor;\n      if (events.length < 1000) break;\n    }\n    state = { ...state, steeringCursor: completionCursor };\n    await save();\n    if (lateSteering) {\n      await publish("activity", {\n        phase: "steering",\n        message: "A new instruction arrived during verification; continuing this Run before completion.",\n      });\n      continue;\n    }\n\n    return { text, verified: verification.outcome === "PASS", checkpoint: state };''',
)

# Coding no longer spends a reflexive second-model review call when repository evidence
# is available, so this regression fixture reaches the post-steering answer on call 3.
replace(
    "test/chat/engine.test.ts",
    '      : response(call >= 5 ? "The late instruction was incorporated." : "Draft answer."),',
    '      : response(call >= 3 ? "The late instruction was incorporated." : "Draft answer."),',
)
