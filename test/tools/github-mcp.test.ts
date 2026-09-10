import assert from "node:assert/strict";
import test from "node:test";
import { GITHUB_MCP_READONLY_URL, GitHubMcpClient } from "../../src/tools/github-mcp.js";

function transport(result: unknown, inspect?: (url: string, init: RequestInit) => void) {
  return async (url: string, init: RequestInit) => {
    inspect?.(url, init);
    const request = JSON.parse(String(init.body)) as { id: number };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
      headers: { "Content-Type": "application/json" },
    });
  };
}

test("S-U GitHub MCP pins the hosted read-only endpoint and never follows redirects", async () => {
  assert.throws(
    () => new GitHubMcpClient("token", "fetch" as never, "https://evil.example/mcp"),
    /not approved/u,
  );
  const client = new GitHubMcpClient(
    "secret-token",
    transport({}, (url, init) => {
      assert.equal(url, GITHUB_MCP_READONLY_URL);
      assert.equal(init.redirect, "error");
      assert.equal((init.headers as Record<string, string>).Authorization, "Bearer secret-token");
    }),
  );
  await client.initialize();
});

test("S-U GitHub MCP exposes allowlisted reads as M3 registrations and rejects writes", async () => {
  const client = new GitHubMcpClient("token", async (_url, init) => {
    const request = JSON.parse(String(init.body)) as { id: number; method: string };
    const result =
      request.method === "initialize"
        ? {}
        : {
            tools: [
              {
                name: "get_file_contents",
                description: "read",
                inputSchema: { type: "object", properties: {}, additionalProperties: false },
              },
              {
                name: "create_or_update_file",
                description: "write",
                inputSchema: { type: "object", properties: {}, additionalProperties: false },
              },
            ],
          };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  });
  const registrations = await client.registrations();
  assert.deepEqual(
    registrations.map((item) => item.manifest.name),
    ["github.mcp.get_file_contents"],
  );
  assert.equal(registrations[0]?.manifest.sideEffecting, false);
  await assert.rejects(client.call("create_or_update_file", {}), /rejected/u);
});

test("S-U GitHub MCP rejects malformed, mismatched and oversized responses", async () => {
  const malformed = new GitHubMcpClient("token", async () => new Response("not-json"));
  await assert.rejects(malformed.initialize(), /malformed JSON/u);
  const mismatched = new GitHubMcpClient(
    "token",
    async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 99, result: {} })),
  );
  await assert.rejects(mismatched.initialize(), /JSON-RPC response was invalid/u);
  const oversized = new GitHubMcpClient(
    "token",
    async () => new Response("x", { headers: { "content-length": "1000001" } }),
  );
  await assert.rejects(oversized.initialize(), /too large/u);
});
