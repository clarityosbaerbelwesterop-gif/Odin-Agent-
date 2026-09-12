import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { GitHubPullRequestClient } from "../../src/chat/github-delivery.js";
import { GitHubWorkspaceSession } from "../../src/chat/github-workspace-session.js";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("M8 creates one PR from the isolated Odin branch and reuses an existing PR", async () => {
  const calls: string[] = [];
  let existing = false;
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/pulls?") && !existing) return json([]);
    if (url.endsWith("/pulls") && init?.method === "POST") {
      existing = true;
      return json(
        { number: 12, html_url: "https://github.com/acme/odin/pull/12", state: "open" },
        201,
      );
    }
    if (url.includes("/pulls?"))
      return json([
        { number: 12, html_url: "https://github.com/acme/odin/pull/12", state: "open" },
      ]);
    throw new Error(`unexpected ${url}`);
  };
  const client = new GitHubPullRequestClient("token", "acme/odin", "main", request);
  const first = await client.ensurePullRequest({
    branch: "odin/work",
    title: "Odin Bot: fix login",
    body: "Verified delivery from Odin Bot.",
  });
  const second = await client.ensurePullRequest({
    branch: "odin/work",
    title: "Odin Bot: fix login",
    body: "Verified delivery from Odin Bot.",
  });
  assert.equal(first.number, 12);
  assert.equal(second.number, 12);
  assert.equal(calls.filter((call) => call.startsWith("POST ")).length, 1);
});

test("M8 GitHub workspace quality checks use the same branch that received edits", async () => {
  const requests: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url}`);
    if (url.includes("/contents/src%2Ffile.ts") || url.includes("/contents/src/file.ts")) {
      if (method === "PUT") return json({ content: { sha: "sha-new" } });
      return json({
        type: "file",
        encoding: "base64",
        content: Buffer.from("old").toString("base64"),
        sha: "sha-old",
      });
    }
    if (url.includes("/git/ref/heads/main")) return json({ object: { sha: "base-sha" } });
    if (url.endsWith("/git/refs") && method === "POST")
      return json({ ref: "refs/heads/odin/work" }, 201);
    if (url.includes("/commits/odin%2F"))
      return json({ check_runs: [{ name: "CI", status: "completed", conclusion: "success" }] });
    throw new Error(`unexpected ${method} ${url}`);
  };

  const session = new GitHubWorkspaceSession("token", "acme/odin", "main", request);
  const workspace = session.workspace(async () => {});
  await workspace.patch({
    path: "src/file.ts",
    expectedSha: "sha-old",
    content: "new",
    signal: AbortSignal.timeout(5_000),
  });
  assert.match(session.branchName() ?? "", /^odin\//u);
  const result = await session.run("github-checks", AbortSignal.timeout(5_000));
  assert.equal(result.exitCode, 0);
  assert.ok(requests.some((call) => call.includes("/check-runs")));
});

test("M8 verifies persisted branch writes when the target repository has no CI", async () => {
  const requests: string[] = [];
  let written = false;
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url}`);
    if (url.includes("/contents/src/file.ts")) {
      if (method === "PUT") {
        written = true;
        return json({ content: { sha: "sha-new" } });
      }
      return json({
        type: "file",
        encoding: "base64",
        content: Buffer.from(written ? "new" : "old").toString("base64"),
        sha: written ? "sha-new" : "sha-old",
      });
    }
    if (url.includes("/git/ref/heads/main")) return json({ object: { sha: "base-sha" } });
    if (url.endsWith("/git/refs") && method === "POST")
      return json({ ref: "refs/heads/odin/work" }, 201);
    if (url.includes("/check-runs")) return json({ check_runs: [] });
    if (url.includes("/contents/.github/workflows")) return json({ message: "Not Found" }, 404);
    throw new Error(`unexpected ${method} ${url}`);
  };

  const session = new GitHubWorkspaceSession("token", "acme/odin", "main", request);
  const workspace = session.workspace(async () => {});
  await workspace.patch({
    path: "src/file.ts",
    expectedSha: "sha-old",
    content: "new",
    signal: AbortSignal.timeout(5_000),
  });
  const result = await session.run("github-checks", AbortSignal.timeout(5_000));
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /verification=branch-integrity-only/u);
  assert.match(result.output, /build\/test correctness remains unverified/u);
  assert.ok(requests.some((call) => call.includes("/contents/.github/workflows")));
});

test("M8 restores a durable Odin branch and its persisted write evidence", async () => {
  const requests: string[] = [];
  const branch = "odin/2026-09-12/1234abcd";
  const contentHash = createHash("sha256").update("new").digest("hex");
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url}`);
    if (url.includes("/contents/src/file.ts"))
      return json({
        type: "file",
        encoding: "base64",
        content: Buffer.from("new").toString("base64"),
        sha: "sha-new",
      });
    if (url.includes("/check-runs")) return json({ check_runs: [] });
    if (url.includes("/contents/.github/workflows")) return json({ message: "Not Found" }, 404);
    if (url.endsWith("/git/refs") && method === "POST")
      throw new Error("a restored session must never create a replacement branch");
    throw new Error(`unexpected ${method} ${url}`);
  };

  const session = new GitHubWorkspaceSession("token", "acme/odin", "main", request, {
    branch,
    writes: [{ path: "src/file.ts", sha: contentHash }],
  });
  session.workspace(async () => {});
  assert.equal(session.branchName(), branch);
  const result = await session.run("github-checks", AbortSignal.timeout(5_000));
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /persistedWrites=1/u);
  assert.equal(
    requests.some((call) => call.startsWith("POST ")),
    false,
  );
});

test("M8 does not bypass configured CI when checks are not available yet", async () => {
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/contents/src/file.ts")) {
      if (method === "PUT") return json({ content: { sha: "sha-new" } });
      return json({
        type: "file",
        encoding: "base64",
        content: Buffer.from("old").toString("base64"),
        sha: "sha-old",
      });
    }
    if (url.includes("/git/ref/heads/main")) return json({ object: { sha: "base-sha" } });
    if (url.endsWith("/git/refs") && method === "POST")
      return json({ ref: "refs/heads/odin/work" }, 201);
    if (url.includes("/check-runs")) return json({ check_runs: [] });
    if (url.includes("/contents/.github/workflows"))
      return json([{ type: "file", path: ".github/workflows/ci.yml" }]);
    throw new Error(`unexpected ${method} ${url}`);
  };

  const session = new GitHubWorkspaceSession("token", "acme/odin", "main", request);
  const workspace = session.workspace(async () => {});
  await workspace.patch({
    path: "src/file.ts",
    expectedSha: "sha-old",
    content: "new",
    signal: AbortSignal.timeout(5_000),
  });
  const result = await session.run("github-checks", AbortSignal.timeout(5_000));
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /workflows exist/u);
});

test("M8 rejects unsafe delivery branches before GitHub is called", async () => {
  let called = false;
  const client = new GitHubPullRequestClient("token", "acme/odin", "main", async () => {
    called = true;
    return json({});
  });
  await assert.rejects(
    client.ensurePullRequest({ branch: "../main", title: "x", body: "x" }),
    /branch is invalid/u,
  );
  assert.equal(called, false);
});
