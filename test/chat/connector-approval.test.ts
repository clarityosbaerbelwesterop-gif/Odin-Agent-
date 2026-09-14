import assert from "node:assert/strict";
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
      f.store.events(f.conversation.id).filter((event) => event.type === "approval.requested")
        .length,
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
      f.store.events(f.conversation.id).filter((event) => event.type === "approval.consumed")
        .length,
      2,
    );
  } finally {
    await f.close();
  }
});
