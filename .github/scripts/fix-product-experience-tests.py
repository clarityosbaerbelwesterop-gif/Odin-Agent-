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

# Coding no longer spends a reflexive second-model review call when repository evidence
# is available, so this regression fixture reaches the post-steering answer on call 3.
replace(
    "test/chat/engine.test.ts",
    '      : response(call >= 5 ? "The late instruction was incorporated." : "Draft answer."),',
    '      : response(call >= 3 ? "The late instruction was incorporated." : "Draft answer."),',
)
