import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ChatEngine } from "../../src/chat/engine.js";
import { hashText } from "../../src/chat/safety.js";
import { ChatStore } from "../../src/chat/store.js";
import { SqliteDurableStore } from "../../src/durable/store.js";
import { fixture, provider, response, until } from "./helpers.js";

test("background execution starts outside the committed mutation context", async () => {
  const transaction = new AsyncLocalStorage<boolean>();
  const model = provider(() => {
    assert.equal(transaction.getStore(), undefined);
    return response();
  });
  const f = await fixture(model, {
    atomic: (action) => transaction.run(true, action),
  });
  try {
    const turn = await f.submit();
    await f.engine.idle();
    assert.equal((await f.engine.view(turn.id)).state, "COMPLETED");
    assert.equal(model.requests.length, 1);
  } finally {
    await f.close();
  }
});

test("chat submits a real durable mission, stores response and survives reopening", async () => {
  const f = await fixture();
  try {
    const turn = await f.submit();
    await f.engine.idle();
    const completed = await f.engine.view(turn.id);
    assert.equal(completed.state, "COMPLETED");
    assert.equal(completed.companionState, "SUCCESS");
    assert.deepEqual(
      completed.plan.map(({ id, status }) => [id, status]),
      [
        ["understand", "done"],
        ["work", "done"],
        ["verify", "done"],
      ],
    );
    assert.equal(
      f.store.events(f.conversation.id).filter((event) => event.type === "answer").length,
      1,
    );
    assert.equal((await f.engine.view(turn.id)).usage.totalTokens, 50);
    const reopened = new ChatStore(join(f.root, "chat.sqlite"));
    assert.equal(reopened.turn(turn.id).objective, "A user task");
    assert.equal(reopened.checkpoint(turn.id)?.usage.totalTokens, 50);
    assert.equal(reopened.conversation(f.conversation.id).id, f.conversation.id);
    reopened.close();
  } finally {
    await f.close();
  }
});

test("duplicate concurrent submissions execute only once and changed replay conflicts", async () => {
  const model = provider(() => response());
  const f = await fixture(model);
  try {
    const [a, b] = await Promise.all([f.submit(), f.submit()]);
    assert.equal(a.id, b.id);
    await f.engine.idle();
    assert.equal(model.requests.length, 1);
    await assert.rejects(f.submit("changed"), /different content/u);
  } finally {
    await f.close();
  }
});

test("thinking and ultra use bounded separate review context and final revision", async () => {
  for (const mode of ["thinking", "ultra"]) {
    const model = provider((_request, call) =>
      response(
        call === 2 ? "Check the arithmetic." : call === 3 ? "Revised response." : "Draft response.",
      ),
    );
    const f = await fixture(model);
    try {
      const turn = await f.submit("Explain this problem", mode);
      await f.engine.idle();
      assert.equal((await f.engine.view(turn.id)).state, "COMPLETED");
      assert.equal(model.requests.length, 3);
      assert.match(
        JSON.stringify(model.requests[1]?.messages[0]),
        /Review this draft independently/u,
      );
      assert.equal(model.requests[1]?.tools, undefined);
      assert.equal(
        f.store.events(f.conversation.id).find((event) => event.type === "answer")?.data.text,
        "Revised response.",
      );
    } finally {
      await f.close();
    }
  }
});

test("cancel during provider work remains terminal against late provider success", async () => {
  let release = () => {};
  let started = false;
  const model = provider(async () => {
    started = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return response("Late success");
  });
  const f = await fixture(model);
  try {
    const turn = await f.submit();
    await until(() => started);
    const current = await f.engine.view(turn.id);
    await f.engine.control(turn.id, "cancel", current.version);
    release();
    await f.engine.idle();
    assert.equal((await f.engine.view(turn.id)).state, "CANCELLED");
    assert.equal(
      f.store.events(f.conversation.id).filter((event) => event.type === "answer").length,
      0,
    );
  } finally {
    release();
    await f.close();
  }
});

test("pause and resume keep the same mission and retain the call ceiling", async () => {
  let started = false;
  const model = provider(async (_request, call, options) => {
    if (call === 1) {
      started = true;
      await new Promise<void>((_resolve, reject) =>
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      );
    }
    return response("Resumed answer.");
  });
  const f = await fixture(model);
  try {
    const turn = await f.submit();
    await until(() => started);
    const paused = await f.engine.control(turn.id, "pause", (await f.engine.view(turn.id)).version);
    assert.equal(paused.state, "PAUSED");
    await f.engine.idle();
    await f.engine.control(turn.id, "resume", paused.version);
    await f.engine.idle();
    assert.equal((await f.engine.view(turn.id)).state, "COMPLETED");
    assert.equal(f.store.checkpoint(turn.id)?.calls, 2);
  } finally {
    await f.close();
  }
});

test("stale controls cannot cancel an updated mission", async () => {
  const f = await fixture();
  try {
    const turn = await f.submit();
    await f.engine.idle();
    await assert.rejects(f.engine.control(turn.id, "cancel", turn.version), /refresh/u);
  } finally {
    await f.close();
  }
});

test("unavailable modes and provider errors remain visible without leaking exceptions", async () => {
  const model = provider(() => {
    throw new Error("secret vendor stack sk-private123456789");
  });
  const f = await fixture(model);
  try {
    const turn = await f.submit();
    await f.engine.idle();
    assert.equal((await f.engine.view(turn.id)).state, "BLOCKED");
    const events = JSON.stringify(f.store.events(f.conversation.id));
    assert.doesNotMatch(events, /private123|vendor stack/u);
    await assert.rejects(
      f.engine.submit({
        conversationId: f.conversation.id,
        text: "x",
        mode: "fake",
        modelId: "fixture",
        requestId: "r2",
      }),
      /supported mode/u,
    );
    const coding = await f.submit("Edit code", "coding", "coding-1");
    await f.engine.idle();
    assert.equal((await f.engine.view(coding.id)).state, "BLOCKED");
    assert(
      f.store
        .events(f.conversation.id)
        .some((event) => event.data.code === "WORKSPACE_UNAVAILABLE"),
    );
  } finally {
    await f.close();
  }
});

test("mode permissions block model-proposed repository writes in Thinking", async () => {
  const model = provider((_request, call) =>
    call === 1
      ? response("", [
          {
            id: "write",
            name: "repo_patch",
            arguments: { path: "x", expectedSha: "absent", content: "x" },
          },
        ])
      : response("I cannot edit in this mode."),
  );
  const f = await fixture(model);
  try {
    await f.submit("Write file", "thinking");
    await f.engine.idle();
    assert(f.store.events(f.conversation.id).some((event) => event.data.code === "TOOL_DENIED"));
  } finally {
    await f.close();
  }
});

test("research retrieves attributed sources and rejects invented source identifiers", async () => {
  for (const citation of ["S1", "S99"]) {
    const model = provider((_request, call) =>
      call === 1
        ? response("", [{ id: "search", name: "research_search", arguments: { query: "Odin" } }])
        : response(`A supported observation [${citation}].`),
    );
    const f = await fixture(model, {
      research: {
        name: "Fixture source boundary",
        search: async () => [
          {
            id: "raw",
            title: "Source",
            url: "https://example.org/source",
            excerpt: "Observed fact.",
            retrievedAt: new Date().toISOString(),
          },
        ],
      },
    });
    try {
      const turn = await f.submit("Research Odin", "research");
      await f.engine.idle();
      assert.equal(
        (await f.engine.view(turn.id)).state,
        citation === "S1" ? "COMPLETED" : "BLOCKED",
      );
      assert.equal(f.store.checkpoint(turn.id)?.sources[0]?.id, "S1");
    } finally {
      await f.close();
    }
  }
});

test("coding edits actual files through M3 and completion depends on final quality evidence", async () => {
  const base = await fixture();
  await base.close();
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const root = await mkdtemp(join(tmpdir(), "odin-code-"));
  const before = "export const add = (a, b) => a - b;\n";
  const after = before.replace("a - b", "a + b");
  await writeFile(join(root, "add.js"), before);
  const model = provider((_request, call) => {
    if (call === 1)
      return response("", [
        { id: "read", name: "repo_read", arguments: { path: "add.js", maxBytes: 4000 } },
      ]);
    if (call === 2)
      return response("", [
        {
          id: "patch",
          name: "repo_patch",
          arguments: { path: "add.js", expectedSha: hashText(before), content: after },
        },
      ]);
    if (call === 3)
      return response("", [
        { id: "check", name: "repo_quality", arguments: { commandId: "addition" } },
      ]);
    return response("The addition function was fixed and checked.");
  });
  const f = await fixture(model, {
    workspaceRoot: root,
    allowWorkspaceWrites: true,
    quality: {
      commands: () => [{ id: "addition", label: "addition checks" }],
      run: async () => ({
        exitCode: (await readFile(join(root, "add.js"), "utf8")) === after ? 0 : 1,
        output: "Exact independent fixture check",
      }),
    },
  });
  try {
    const turn = await f.submit("Fix addition", "coding");
    await f.engine.idle();
    assert.equal((await f.engine.view(turn.id)).state, "COMPLETED");
    assert.equal(await readFile(join(root, "add.js"), "utf8"), after);
    assert(f.store.events(f.conversation.id).some((event) => event.type === "file.changed"));
  } finally {
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a reopened server pauses an interrupted canonical mission without replaying effects", async () => {
  const model = provider(() => response());
  const f = await fixture(model, { autoRun: false });
  try {
    const turn = await f.submit();
    await f.engine.idle();
    assert.equal((await f.engine.view(turn.id)).state, "CREATED");
    const reopenedStore = new ChatStore(join(f.root, "chat.sqlite"));
    const reopenedEvents = new SqliteDurableStore(join(f.root, "missions.sqlite"));
    const restarted = new ChatEngine({ store: reopenedStore, events: reopenedEvents, models: [] });
    await restarted.initialize();
    assert.equal((await restarted.view(turn.id)).state, "PAUSED");
    assert.equal(model.requests.length, 0);
    await restarted.close();
    reopenedStore.close();
    reopenedEvents.close();
  } finally {
    await f.close();
  }
});

test("follow-up messages receive bounded, durable conversation history", async () => {
  const model = provider(() => response("The previous answer is cobalt."));
  const f = await fixture(model);
  try {
    await f.submit("Remember the colour cobalt");
    await f.engine.idle();
    await f.submit("Which colour?", "chat", "follow-up");
    await f.engine.idle();
    assert.match(JSON.stringify(model.requests[1]?.messages), /Remember the colour cobalt/u);
    assert.match(JSON.stringify(model.requests[1]?.messages), /previous answer is cobalt/u);
  } finally {
    await f.close();
  }
});

test("steering accepted during final quality verification is processed before completion", async () => {
  let atQuality = false;
  let release = () => {};
  const model = provider((_request, call) =>
    call === 1
      ? response("", [
          {
            id: "patch",
            name: "repo_patch",
            arguments: { path: "index.html", expectedSha: "absent", content: "<p>Draft</p>" },
          },
        ])
      : response(call >= 5 ? "The late instruction was incorporated." : "Draft answer."),
  );
  const f = await fixture(model, {
    allowWorkspaceWrites: true,
    workspace: (changed) => ({
      search: async () => [],
      read: async () => ({ content: "", sha: "absent", truncated: false }),
      patch: async ({ path, content }) => {
        await changed({ path, before: null, after: content, sha: hashText(content) });
        return { sha: hashText(content) };
      },
    }),
    quality: {
      commands: () => [{ id: "syntax", label: "Test quality boundary" }],
      run: async () => {
        if (!atQuality) {
          atQuality = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return { exitCode: 0, output: "Checked" };
      },
    },
  });
  try {
    const turn = await f.submit("Create a page", "coding");
    await until(() => atQuality);
    await f.engine.steer(turn.id, "Include the late instruction.");
    release();
    await f.engine.idle();
    assert.equal((await f.engine.view(turn.id)).state, "COMPLETED");
    assert.match(JSON.stringify(model.requests.at(-1)?.messages), /Include the late instruction/u);
    const answers = f.store.events(f.conversation.id).filter((event) => event.type === "answer");
    assert.equal(answers.length, 1);
    assert.match(String(answers[0]?.data.text), /late instruction was incorporated/u);
  } finally {
    release();
    await f.close();
  }
});

test("resumed uncertain calls are not replayed and unavailable usage remains explicit", async () => {
  const model = provider((request) => {
    assert(
      request.messages.some(
        (message) =>
          message.role === "tool" &&
          message.toolCallId === "lost-call" &&
          /not replayed/u.test(message.content),
      ),
    );
    return response("Interrupted call inspected.");
  });
  const f = await fixture(model, { autoRun: false });
  try {
    const turn = await f.submit();
    f.store.save(turn.id, {
      messages: [
        { role: "user", content: [{ type: "text", text: "Inspect" }] },
        {
          role: "assistant",
          content: [],
          toolCalls: [{ id: "lost-call", name: "math_evaluate", arguments: { expression: "1+1" } }],
        },
      ],
      calls: 1,
      toolCalls: 0,
      sources: [],
      changes: [],
      reviewed: false,
      steeringCursor: 0,
      usageUnknown: true,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    await f.engine.execute(turn.id);
    assert.equal(model.requests.length, 1);
    assert.equal(f.store.checkpoint(turn.id)?.usageUnknown, true);
    assert.equal(f.store.checkpoint(turn.id)?.toolCalls, 0);
    assert.equal((await f.engine.view(turn.id)).state, "BLOCKED");
  } finally {
    await f.close();
  }
});
