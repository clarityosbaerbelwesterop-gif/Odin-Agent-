from pathlib import Path


def patch(path: str, before: str, after: str, label: str) -> None:
    target = Path(path)
    text = target.read_text()
    if after in text:
        return
    if before not in text:
        raise SystemExit(f"{label}: expected source shape not found")
    target.write_text(text.replace(before, after, 1))


# Remote tool policy: never expose known credential-returning tools to the model.
patch(
    "src/connectors/types.ts",
    '''  readonly alwaysApprovalPrefixes: readonly string[];\n  readonly metered: boolean;''',
    '''  readonly alwaysApprovalPrefixes: readonly string[];\n  readonly blockedTools?: readonly string[];\n  readonly metered: boolean;''',
    "connector blocked tools type",
)
patch(
    "src/connectors/catalog.ts",
    '''      readPrefixes: [...READ, "prepare_database_migration", "explain_sql_statement"],\n      searchPrefixes: SEARCH,\n      writePrefixes: [...WRITE, "run_sql", "run_sql_transaction", "apply_database_migration"],\n      alwaysApprovalPrefixes: [\n        "run_sql",\n        "run_sql_transaction",\n        "apply_database_migration",\n        ...DESTRUCTIVE,\n      ],''',
    '''      readPrefixes: [...READ, "explain_sql_statement"],\n      searchPrefixes: SEARCH,\n      writePrefixes: [\n        ...WRITE,\n        "run_sql",\n        "run_sql_transaction",\n        "prepare_database_migration",\n        "complete_database_migration",\n        "prepare_query_tuning",\n        "complete_query_tuning",\n        "apply_database_migration",\n      ],\n      alwaysApprovalPrefixes: [\n        "run_sql",\n        "run_sql_transaction",\n        "prepare_database_migration",\n        "complete_database_migration",\n        "prepare_query_tuning",\n        "complete_query_tuning",\n        "apply_database_migration",\n        ...DESTRUCTIVE,\n      ],\n      blockedTools: ["get_connection_string"],''',
    "neon write classification",
)

# Official connectors may only override path/query on their own official origin.
patch(
    "src/connectors/service.ts",
    '''function publicDescriptor(descriptor: ConnectorDescriptor): ConnectorDescriptor {\n  return Object.freeze(structuredClone(descriptor));\n}\n''',
    '''function publicDescriptor(descriptor: ConnectorDescriptor): ConnectorDescriptor {\n  return Object.freeze(structuredClone(descriptor));\n}\n\nfunction connectorEndpoint(\n  descriptor: ConnectorDescriptor,\n  requested: string | undefined,\n): string {\n  const candidate =\n    requested && (descriptor.endpointRequired || descriptor.allowEndpointOverride)\n      ? requested\n      : (descriptor.officialMcpUrl ?? requested);\n  if (!candidate)\n    throw new ConnectorError("INVALID_INPUT", "A remote MCP endpoint is required.");\n  if (requested && descriptor.officialMcpUrl && descriptor.allowEndpointOverride) {\n    let requestedUrl: URL;\n    let officialUrl: URL;\n    try {\n      requestedUrl = new URL(requested);\n      officialUrl = new URL(descriptor.officialMcpUrl);\n    } catch {\n      throw new ConnectorError("ENDPOINT_DENIED", "Connector endpoint is invalid.");\n    }\n    if (requestedUrl.origin !== officialUrl.origin)\n      throw new ConnectorError(\n        "ENDPOINT_DENIED",\n        "Official connector overrides must stay on the official MCP origin.",\n        403,\n      );\n  }\n  return candidate;\n}\n''',
    "official endpoint selector",
)
old_endpoint = '''    const rawEndpoint =\n      input.endpoint && (descriptor.endpointRequired || descriptor.allowEndpointOverride)\n        ? input.endpoint\n        : (descriptor.officialMcpUrl ?? input.endpoint);\n    if (!rawEndpoint)\n      throw new ConnectorError("INVALID_INPUT", "A remote MCP endpoint is required.");'''
new_endpoint = '''    const rawEndpoint = connectorEndpoint(descriptor, input.endpoint);'''
service = Path("src/connectors/service.ts")
text = service.read_text()
if old_endpoint in text:
    text = text.replace(old_endpoint, new_endpoint, 2)
service.write_text(text)
patch(
    "src/connectors/service.ts",
    '''    const remote = await client.listTools();\n    const now = new Date();''',
    '''    const remote = (await client.listTools()).filter(\n      (tool) => !descriptor.policy.blockedTools?.includes(tool.name.toLowerCase()),\n    );\n    const now = new Date();''',
    "blocked remote tools filter",
)
patch(
    "src/connectors/service.ts",
    '''      const connection = await this.store.saveTokenSet(transaction.connectionId, token, {\n        issuer: transaction.issuer,\n        resource: transaction.resource,\n        clientId: transaction.clientId,\n      });''',
    '''      const connection = await this.store.saveTokenSet(transaction.connectionId, token, {\n        issuer: transaction.issuer,\n        resource: transaction.resource,\n        clientId: transaction.clientId,\n        ...(transaction.clientSecret ? { clientSecret: transaction.clientSecret } : {}),\n      });''',
    "oauth client secret persistence call",
)

# Preserve confidential OAuth client credentials across refreshes.
patch(
    "src/connectors/store.ts",
    '''    metadata: { readonly issuer: string; readonly resource: string; readonly clientId: string },\n  ): Promise<ConnectorConnection> {\n    const access = this.vault.seal(token.accessToken).ciphertext;\n    const refresh = token.refreshToken ? this.vault.seal(token.refreshToken).ciphertext : null;''',
    '''    metadata: {\n      readonly issuer: string;\n      readonly resource: string;\n      readonly clientId: string;\n      readonly clientSecret?: string;\n    },\n  ): Promise<ConnectorConnection> {\n    const access = this.vault.seal(token.accessToken).ciphertext;\n    const refresh = token.refreshToken ? this.vault.seal(token.refreshToken).ciphertext : null;\n    const clientSecret = metadata.clientSecret\n      ? this.vault.seal(metadata.clientSecret).ciphertext\n      : null;''',
    "store client secret metadata",
)
patch(
    "src/connectors/store.ts",
    '''             token_expires_at=$5,scopes=$6,issuer=$7,resource=$8,client_id=$9,\n             last_verified_at=now(),last_error_code=NULL,updated_at=now()\n           WHERE id=$1 RETURNING *`,''',
    '''             token_expires_at=$5,scopes=$6,issuer=$7,resource=$8,client_id=$9,\n             client_secret_ciphertext=COALESCE($10,client_secret_ciphertext),\n             last_verified_at=now(),last_error_code=NULL,updated_at=now()\n           WHERE id=$1 RETURNING *`,''',
    "store client secret SQL",
)
patch(
    "src/connectors/store.ts",
    '''            metadata.resource,\n            metadata.clientId,\n          ],''',
    '''            metadata.resource,\n            metadata.clientId,\n            clientSecret,\n          ],''',
    "store client secret parameter",
)

# Tool cache identities are connection-scoped, never globally provider-scoped.
patch(
    "migrations/017_connector_platform.sql",
    '''  UNIQUE(owner_id,tool_name),''',
    '''  UNIQUE(owner_id,connection_id,tool_name),''',
    "connection scoped tool cache uniqueness",
)

# High-risk approvals are one-use. Interrupted high-risk calls invalidate any old grant so an
# uncertain irreversible outcome is never automatically replayed.
patch(
    "src/chat/agent.ts",
    '''  const pending = new Set<string>();\n  for (const message of state.messages) {\n    if (message.role === "assistant")\n      for (const call of message.toolCalls ?? []) pending.add(call.id);\n    if (message.role === "tool") pending.delete(message.toolCallId);\n  }\n  for (const id of pending) {\n    uncertainEffects = true;\n    await add({\n      role: "tool",\n      toolCallId: id,\n      isError: true,\n      content:\n        "Execution was interrupted. Outcome is unknown. This call was not replayed. Read the current workspace and verify it before any further change.",\n    });\n  }''',
    '''  const pending = new Map<string, NonNullable<ModelMessage["toolCalls"]>[number]>();\n  for (const message of state.messages) {\n    if (message.role === "assistant")\n      for (const call of message.toolCalls ?? []) pending.set(call.id, call);\n    if (message.role === "tool") pending.delete(message.toolCallId);\n  }\n  for (const [id, call] of pending) {\n    uncertainEffects = true;\n    try {\n      const name = tools.resolveName(call.name);\n      const registration = tools.registry.resolveRegistration(name, "1");\n      if (registration.manifest.riskClass === "high") {\n        const inputHash = hashText(JSON.stringify(call.arguments));\n        const approvalId = hashText(`${turn.id}\\u0000${name}\\u0000${inputHash}`);\n        await publish("approval.outcome_unknown", {\n          approvalId,\n          tool: name,\n          inputHash,\n          risk: "high",\n          action: registration.manifest.summary,\n        });\n      }\n    } catch {\n      // The unresolved proposal remains untrusted and is not replayed even if the tool vanished.\n    }\n    await add({\n      role: "tool",\n      toolCallId: id,\n      isError: true,\n      content:\n        "Execution was interrupted. Outcome is unknown. This call was not replayed. Read the current workspace and verify it before any further change.",\n    });\n  }''',
    "unknown high-risk outcome invalidation",
)
patch(
    "src/chat/agent.ts",
    '''          const result = await runtime.execute({\n            missionId: turn.id,\n            taskId: "work",\n            tool: name,\n            version: "1",\n            input: runtimeInput,\n            idempotencyKey: `${turn.id}-${state.calls}-${tool.id}`,\n            ...(approval ? { approval } : {}),\n            signal,\n          });\n          signal.throwIfAborted();''',
    '''          const result = await runtime.execute({\n            missionId: turn.id,\n            taskId: "work",\n            tool: name,\n            version: "1",\n            input: runtimeInput,\n            idempotencyKey: approval?.approvalId ?? `${turn.id}-${state.calls}-${tool.id}`,\n            ...(approval ? { approval } : {}),\n            signal,\n          });\n          if (approval)\n            await publish("approval.consumed", {\n              approvalId: approval.approvalId,\n              tool: name,\n              inputHash,\n            });\n          signal.throwIfAborted();''',
    "approval consumption after effect",
)
patch(
    "src/chat/agent.ts",
    '''  let cursor = 0;\n  let granted: ChatEvent | undefined;\n  let denied = false;\n  while (true) {\n    const events = await store.events(conversationId, cursor, 1000);\n    for (const event of events) {\n      if (event.turnId !== turnId || event.data.approvalId !== approvalId) continue;\n      if (event.type === "approval.granted") granted = event;\n      if (event.type === "approval.denied") denied = true;\n    }\n    cursor = events.at(-1)?.cursor ?? cursor;\n    if (events.length < 1000) break;\n  }\n  if (!granted || denied) return undefined;''',
    '''  let cursor = 0;\n  let granted: ChatEvent | undefined;\n  let denied = false;\n  let consumed = false;\n  let requested = false;\n  while (true) {\n    const events = await store.events(conversationId, cursor, 1000);\n    for (const event of events) {\n      if (event.turnId !== turnId || event.data.approvalId !== approvalId) continue;\n      if (event.type === "approval.requested") {\n        requested = true;\n        granted = undefined;\n        denied = false;\n        consumed = false;\n      } else if (requested && event.type === "approval.granted") granted = event;\n      else if (requested && event.type === "approval.denied") denied = true;\n      else if (\n        requested &&\n        (event.type === "approval.consumed" || event.type === "approval.outcome_unknown")\n      )\n        consumed = true;\n    }\n    cursor = events.at(-1)?.cursor ?? cursor;\n    if (events.length < 1000) break;\n  }\n  if (!requested || !granted || denied || consumed) return undefined;''',
    "approval cycle evidence",
)

# Resolve only the latest approval request cycle. A consumed approval may be requested again,
# but double-clicking the same current request cannot create duplicate grants.
api = Path("src/connectors/api.ts")
api_text = api.read_text()
api_text = api_text.replace(
    '''      const request = await approvalRequest(chat, turn.conversationId, turn.id, approval[2] ?? "");\n      if (Date.parse(String(request.expiresAt ?? "")) <= Date.now())''',
    '''      const requestEvent = await approvalRequest(\n        chat,\n        turn.conversationId,\n        turn.id,\n        approval[2] ?? "",\n      );\n      const request = requestEvent.data;\n      if (Date.parse(String(request.expiresAt ?? "")) <= Date.now())''',
    1,
)
api_text = api_text.replace(
    '''        approval[2] ?? "",\n      );''',
    '''        approval[2] ?? "",\n        requestEvent.cursor,\n      );''',
    1,
)
api_text = api_text.replace(
    '''  let cursor = 0;\n  while (true) {\n    const events = await store.events(conversationId, cursor, 1000);\n    for (const event of events)\n      if (\n        event.turnId === turnId &&\n        event.type === "approval.requested" &&\n        event.data.approvalId === approvalId\n      )\n        return event.data;\n    cursor = events.at(-1)?.cursor ?? cursor;\n    if (events.length < 1000) break;\n  }\n  throw new ChatError("APPROVAL_NOT_FOUND", "Approval request not found.", 404);''',
    '''  let cursor = 0;\n  let latest: ChatEvent | undefined;\n  while (true) {\n    const events = await store.events(conversationId, cursor, 1000);\n    for (const event of events)\n      if (\n        event.turnId === turnId &&\n        event.type === "approval.requested" &&\n        event.data.approvalId === approvalId\n      )\n        latest = event;\n    cursor = events.at(-1)?.cursor ?? cursor;\n    if (events.length < 1000) break;\n  }\n  if (latest) return latest;\n  throw new ChatError("APPROVAL_NOT_FOUND", "Approval request not found.", 404);''',
    1,
)
api_text = api_text.replace(
    '''  approvalId: string,\n) {\n  let cursor = 0;''',
    '''  approvalId: string,\n  afterCursor: number,\n) {\n  let cursor = afterCursor;''',
    1,
)
api.write_text(api_text)

# Surface uncertain irreversible outcomes in the live work panel.
patch(
    "web/live-work.js",
    '''  if (event.type === "approval.granted" || event.type === "approval.denied") {\n    if (state.approval?.approvalId === data.approvalId) state.approval = null;\n    byId("live-approval").hidden = true;\n    addStep(\n      event.type === "approval.granted" ? "External action approved" : "External action denied",\n      event.type === "approval.granted" ? "done" : "failed",\n      String(data.tool ?? "connector action"),\n    );\n    return;\n  }''',
    '''  if (event.type === "approval.granted" || event.type === "approval.denied") {\n    if (state.approval?.approvalId === data.approvalId) state.approval = null;\n    byId("live-approval").hidden = true;\n    addStep(\n      event.type === "approval.granted" ? "External action approved" : "External action denied",\n      event.type === "approval.granted" ? "done" : "failed",\n      String(data.tool ?? "connector action"),\n    );\n    return;\n  }\n  if (event.type === "approval.outcome_unknown") {\n    state.approval = null;\n    byId("live-approval").hidden = true;\n    byId("live-work-current").textContent = "External action outcome needs inspection";\n    addStep(\n      "External action outcome unknown",\n      "failed",\n      "Odin will not repeat it automatically",\n    );\n    return;\n  }''',
    "live unknown outcome",
)

# Strengthen connector contracts.
test_path = Path("test/chat/connector-platform.test.ts")
test_text = test_path.read_text()
test_text = test_text.replace(
    '''  assert.deepEqual(neon.defaultScopes, ["read"]);''',
    '''  assert.deepEqual(neon.defaultScopes, ["read"]);\n  assert.deepEqual(neon.policy.blockedTools, ["get_connection_string"]);\n  const migration = classifyRemoteTool(neon, tool("prepare_database_migration"));\n  assert.equal(migration.operation, "write");\n  assert.equal(migration.riskClass, "high");\n  assert.equal(migration.requiresApproval, true);''',
    1,
)
test_text = test_text.replace(
    '''  assert.match(migration, /UNIQUE\\(owner_id,tool_name\\)/u);''',
    '''  assert.doesNotMatch(migration, /UNIQUE\\(owner_id,tool_name\\)/u);\n  assert.match(migration, /UNIQUE\\(owner_id,connection_id,tool_name\\)/u);''',
    1,
) if 'UNIQUE\\(owner_id,tool_name\\)' in test_text else test_text
# Append source-level contracts for secret persistence and endpoint pinning; behavioral approval
# coverage is in connector-approval.test.ts below.
test_text += '''\n\ntest("connector security hardening preserves OAuth secrets and pins official overrides", async () => {\n  const service = await readFile(join(process.cwd(), "src/connectors/service.ts"), "utf8");\n  const store = await readFile(join(process.cwd(), "src/connectors/store.ts"), "utf8");\n  const migration = await readFile(join(process.cwd(), "migrations/017_connector_platform.sql"), "utf8");\n  assert.match(service, /requestedUrl\\.origin !== officialUrl\\.origin/u);\n  assert.match(service, /blockedTools/u);\n  assert.match(store, /client_secret_ciphertext=COALESCE\\(\\$10,client_secret_ciphertext\\)/u);\n  assert.match(store, /metadata\\.clientSecret/u);\n  assert.doesNotMatch(migration, /UNIQUE\\(owner_id,tool_name\\)/u);\n  assert.match(migration, /UNIQUE\\(owner_id,connection_id,tool_name\\)/u);\n});\n'''
test_path.write_text(test_text)

Path("test/chat/connector-approval.test.ts").write_text(r'''import assert from "node:assert/strict";
import test from "node:test";
import type { ToolRegistration } from "../../src/tools/types.js";
import { fixture, provider, response } from "./helpers.js";

function highRiskTool(execute: () => void): ToolRegistration {
  return {
    manifest: {
      name: "connector.fixture.deadbeef.send_message",
      version: "1",
      summary: "Send an external message",
      description: "Fixture high-risk connector action",
      operation: "write",
      riskClass: "high",
      sideEffecting: true,
      trustClass: "project",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { argumentsJson: { type: "string", minLength: 2, maxLength: 1000 } },
        required: ["argumentsJson"],
      },
      retryPolicy: { maxAttempts: 1, retryableCategories: [], timeoutMs: 1000 },
      provenance: {
        kind: "project",
        observedAt: "2026-09-14T00:00:00.000Z",
        reference: "connector-fixture",
      },
    },
    resourceFromInput: () => ".",
    handler: async () => {
      execute();
      return { sent: true };
    },
  };
}

async function grantLatest(f: Awaited<ReturnType<typeof fixture>>, turnId: string) {
  const requests = f.store
    .events(f.conversation.id)
    .filter((event) => event.turnId === turnId && event.type === "approval.requested");
  const request = requests.at(-1);
  assert(request);
  await f.store.emit(await f.store.turn(turnId), "approval.granted", {
    approvalId: request.data.approvalId,
    tool: request.data.tool,
    inputHash: request.data.inputHash,
    expiresAt: request.data.expiresAt,
    risk: "high",
    action: request.data.action,
  });
}

test("high-risk connector approval pauses the same Run and each grant is consumed once", async () => {
  let executions = 0;
  const toolCall = () => ({
    id: `external-${Math.random()}`,
    name: "connector_fixture_deadbeef_send_message",
    arguments: { argumentsJson: JSON.stringify({ recipient: "fixture", body: "hello" }) },
  });
  const model = provider((_request, call) => {
    if (call <= 4) return response("", [toolCall()]);
    return response(call === 6 ? "Review passed." : "Finished after explicit approvals.");
  });
  const f = await fixture(model, {
    toolRegistrations: async () => [highRiskTool(() => (executions += 1))],
  });
  try {
    const turn = await f.submit("Send the fixture message twice only with approval", "ultra");
    await f.engine.idle();
    let paused = await f.engine.view(turn.id);
    assert.equal(paused.state, "PAUSED");
    assert.equal(executions, 0);
    assert.equal(
      f.store.events(f.conversation.id).filter((event) => event.type === "approval.requested").length,
      1,
    );

    await grantLatest(f, turn.id);
    await f.engine.control(turn.id, "resume", paused.version);
    await f.engine.idle();
    paused = await f.engine.view(turn.id);
    assert.equal(paused.state, "PAUSED");
    assert.equal(executions, 1);
    const afterFirst = f.store.events(f.conversation.id);
    assert.equal(afterFirst.filter((event) => event.type === "approval.consumed").length, 1);
    assert.equal(afterFirst.filter((event) => event.type === "approval.requested").length, 2);

    await grantLatest(f, turn.id);
    await f.engine.control(turn.id, "resume", paused.version);
    await f.engine.idle();
    assert.equal(executions, 2);
    const final = await f.engine.view(turn.id);
    assert.equal(final.state, "COMPLETED");
    assert.equal(
      f.store.events(f.conversation.id).filter((event) => event.type === "approval.consumed").length,
      2,
    );
  } finally {
    await f.close();
  }
});
''')
