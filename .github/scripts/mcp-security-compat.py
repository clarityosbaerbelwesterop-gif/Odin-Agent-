from pathlib import Path

# The hardening script runs against the current product tree. Keep this tiny compatibility
# layer focused on type-level/generated-shape adjustments so the security changes themselves
# stay readable and auditable.
api = Path("src/connectors/api.ts")
text = api.read_text()
before = 'import { ChatError } from "../chat/types.js";'
after = 'import { ChatError, type ChatEvent } from "../chat/types.js";'
if after not in text:
    if before not in text:
        raise SystemExit("connector API import shape changed")
    text = text.replace(before, after, 1)

wrong_request = '''      const requestEvent = await approvalRequest(\n        chat,\n        turn.conversationId,\n        turn.id,\n        approval[2] ?? "",\n        requestEvent.cursor,\n      );'''
right_request = '''      const requestEvent = await approvalRequest(\n        chat,\n        turn.conversationId,\n        turn.id,\n        approval[2] ?? "",\n      );'''
if wrong_request in text:
    text = text.replace(wrong_request, right_request, 1)

wrong_resolution = '''      const resolved = await approvalResolution(\n        chat,\n        turn.conversationId,\n        turn.id,\n        approval[2] ?? "",\n      );'''
right_resolution = '''      const resolved = await approvalResolution(\n        chat,\n        turn.conversationId,\n        turn.id,\n        approval[2] ?? "",\n        requestEvent.cursor,\n      );'''
if wrong_resolution in text:
    text = text.replace(wrong_resolution, right_resolution, 1)

wrong_request_signature = '''async function approvalRequest(\n  store: NeonChatStore,\n  conversationId: string,\n  turnId: string,\n  approvalId: string,\n  afterCursor: number,\n) {\n  let cursor = afterCursor;'''
right_request_signature = '''async function approvalRequest(\n  store: NeonChatStore,\n  conversationId: string,\n  turnId: string,\n  approvalId: string,\n) {\n  let cursor = 0;'''
if wrong_request_signature in text:
    text = text.replace(wrong_request_signature, right_request_signature, 1)

wrong_resolution_signature = '''async function approvalResolution(\n  store: NeonChatStore,\n  conversationId: string,\n  turnId: string,\n  approvalId: string,\n) {\n  let cursor = 0;'''
right_resolution_signature = '''async function approvalResolution(\n  store: NeonChatStore,\n  conversationId: string,\n  turnId: string,\n  approvalId: string,\n  afterCursor: number,\n) {\n  let cursor = afterCursor;'''
if wrong_resolution_signature in text:
    text = text.replace(wrong_resolution_signature, right_resolution_signature, 1)

if "requestEvent.cursor" not in text or "let cursor = afterCursor;" not in text:
    raise SystemExit("approval resolution cursor binding is missing")
api.write_text(text)

agent = Path("src/chat/agent.ts")
agent_text = agent.read_text()
old_import = 'import type { ModelMessage, ModelRequest, ModelResponse } from "../providers/types.js";'
new_import = 'import type { ModelMessage, ModelRequest, ModelResponse, ToolCall } from "../providers/types.js";'
if new_import not in agent_text:
    if old_import not in agent_text:
        raise SystemExit("ChatAgent provider type import shape changed")
    agent_text = agent_text.replace(old_import, new_import, 1)
agent_text = agent_text.replace(
    'const pending = new Map<string, NonNullable<ModelMessage["toolCalls"]>[number]>();',
    'const pending = new Map<string, ToolCall>();',
    1,
)
agent.write_text(agent_text)
