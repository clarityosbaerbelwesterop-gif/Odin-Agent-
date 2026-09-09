import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { calculate } from "../../src/chat/calculator.js";
import { DEFAULT_CHAT_LIMITS, modePolicy } from "../../src/chat/modes.js";
import { WikipediaResearchAdapter } from "../../src/chat/research.js";
import { hashText } from "../../src/chat/safety.js";
import { LocalChatWorkspace } from "../../src/chat/workspace.js";
import { capabilityProfile } from "../providers/helpers.js";
import { fixture, provider, response } from "./helpers.js";

test("calculator obeys precedence and refuses executable, malformed and unbounded input", () => {
  assert.equal(calculate("(12 + 8) * 3 - 4 / 2"), 58);
  assert.equal(calculate("2^3^2"), 512);
  assert.equal(calculate("-2^2"), -4);
  assert.equal(calculate("1e2 + .5"), 100.5);
  for (const value of ["", "process.exit()", "1/0", "1 2", "1+", "(1+2", "2^999", "1e18"])
    assert.throws(() => calculate(value), { name: "ChatError" }, value);
});

test("effort never invents unsupported provider capability and modes obey runtime ceilings", () => {
  const profile = capabilityProfile("fixture", "model", {
    reasoningEfforts: ["low"],
    maxOutputTokens: 512,
  });
  const policy = modePolicy("ultra", profile, {
    ...DEFAULT_CHAT_LIMITS,
    maxCalls: 2,
    maxToolCalls: 3,
  });
  assert.equal(policy.reasoningEffort, "low");
  assert.equal(policy.calls, 2);
  assert.equal(policy.tools, 3);
  assert.equal(policy.output, 512);
});

test("workspace handles real text files, stale hashes, secrets, traversal and symlink escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "odin-workspace-"));
  const outside = await mkdtemp(join(tmpdir(), "odin-private-"));
  const signal = new AbortController().signal;
  try {
    await writeFile(join(root, "a.js"), "const x = 1;\n");
    await writeFile(join(outside, "private.txt"), "private");
    await writeFile(join(root, ".env"), "secret");
    await symlink(outside, join(root, "escape"));
    const workspace = await LocalChatWorkspace.create(root, true);
    assert.equal(
      (await workspace.search({ query: "x", path: ".", maxResults: 10, signal }))[0]?.path,
      "a.js",
    );
    const read = await workspace.read({ path: "a.js", maxBytes: 100, signal });
    assert.equal(read.sha, hashText(read.content));
    await workspace.patch({
      path: "a.js",
      expectedSha: read.sha,
      content: "const x = 2;\n",
      signal,
    });
    assert.equal(await readFile(join(root, "a.js"), "utf8"), "const x = 2;\n");
    await assert.rejects(
      workspace.patch({ path: "a.js", expectedSha: read.sha, content: "bad", signal }),
      /changed/u,
    );
    await workspace.patch({
      path: "new/file.js",
      expectedSha: "absent",
      content: "new text",
      signal,
    });
    assert.equal(await readFile(join(root, "new/file.js"), "utf8"), "new text");
    for (const path of ["../private.txt", ".env", "escape/private.txt"])
      await assert.rejects(workspace.read({ path, maxBytes: 100, signal }));
    await assert.rejects(
      workspace.patch({ path: "AGENTS.md", expectedSha: "absent", content: "override", signal }),
      /protected/u,
    );
    await assert.rejects(
      workspace.patch({
        path: "token.txt",
        expectedSha: "absent",
        content: "sk-supersecret123456789",
        signal,
      }),
      /credentials/u,
    );
    const readonly = await LocalChatWorkspace.create(root, false);
    await assert.rejects(
      readonly.patch({ path: "x", expectedSha: "absent", content: "x", signal }),
      /disabled/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("Wikipedia adapter encodes search text, bounds results and refuses foreign source URLs", async () => {
  let requested = "";
  const adapter = new WikipediaResearchAdapter("de", async (url) => {
    requested = url;
    return {
      query: {
        pages: [
          {
            title: "Odin",
            fullurl: "https://de.wikipedia.org/wiki/Odin",
            extract: "A source excerpt.",
          },
        ],
      },
    };
  });
  const results = await adapter.search("a&redirect=evil", new AbortController().signal);
  assert.equal(new URL(requested).searchParams.get("gsrsearch"), "a&redirect=evil");
  assert.equal(results.length, 1);
  assert.equal(results[0]?.id, "S1");
  const hostile = new WikipediaResearchAdapter("en", async () => ({
    query: { pages: [{ title: "x", fullurl: "https://localhost/secret", extract: "x" }] },
  }));
  await assert.rejects(hostile.search("x", new AbortController().signal), /escaped/u);
  const empty = new WikipediaResearchAdapter("en", async () => ({ batchcomplete: true }));
  assert.deepEqual(await empty.search("x", new AbortController().signal), []);
});

test("input and output secrets are rejected and budgets stop without hidden extra calls", async () => {
  const model = provider(() => response("sk-privatekey123456789"));
  const f = await fixture(model);
  try {
    await assert.rejects(f.submit("ghp_abcdefghijklmnop"), /credentials/u);
    const turn = await f.submit("normal");
    await f.engine.idle();
    assert.equal((await f.engine.view(turn.id)).state, "BLOCKED");
    assert.doesNotMatch(JSON.stringify(f.store.events(f.conversation.id)), /privatekey/u);
  } finally {
    await f.close();
  }
  const loop = provider((_req, call) =>
    response("", [
      { id: `tool-${call}`, name: "math_calculate", arguments: { expression: "2+2" } },
    ]),
  );
  const bounded = await fixture(loop, { limits: { ...DEFAULT_CHAT_LIMITS, maxCalls: 2 } });
  try {
    const turn = await bounded.submit();
    await bounded.engine.idle();
    assert.equal(loop.requests.length, 2);
    assert.equal((await bounded.engine.view(turn.id)).state, "BLOCKED");
  } finally {
    await bounded.close();
  }
});
