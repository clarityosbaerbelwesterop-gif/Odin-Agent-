import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { classifyRemoteTool, connectorDescriptor } from "../../src/connectors/catalog.js";

const tool = (name: string) => ({ name, inputSchema: { type: "object", properties: {} } });

test("first-class MCP catalog is secure-by-default for requested providers", () => {
  const neon = connectorDescriptor("neon");
  assert.equal(neon.trust, "official");
  assert.match(neon.officialMcpUrl ?? "", /^https:\/\/mcp\.neon\.tech\/mcp\?readonly=true$/u);
  assert.deepEqual(neon.defaultScopes, ["read"]);
  assert.deepEqual(neon.policy.blockedTools, ["get_connection_string"]);
  const migration = classifyRemoteTool(neon, tool("prepare_database_migration"));
  assert.equal(migration.operation, "write");
  assert.equal(migration.riskClass, "high");
  assert.equal(migration.requiresApproval, true);
  assert.equal(connectorDescriptor("vercel").officialMcpUrl, "https://mcp.vercel.com");
  assert.equal(connectorDescriptor("google-workspace").endpointRequired, true);
  assert.equal(connectorDescriptor("linkedin").trust, "community");
  assert.deepEqual(connectorDescriptor("linkedin").authModes, ["none", "api_key"]);
});

test("remote MCP writes and unknown tools fail toward approval while reads remain non-side-effecting", () => {
  const linkedin = connectorDescriptor("linkedin");
  assert.equal(classifyRemoteTool(linkedin, tool("get_person_profile")).sideEffecting, false);
  const message = classifyRemoteTool(linkedin, tool("send_message"));
  assert.equal(message.riskClass, "high");
  assert.equal(message.requiresApproval, true);
  const unknown = classifyRemoteTool(linkedin, tool("surprise_future_operation"));
  assert.equal(unknown.riskClass, "high");
  assert.equal(unknown.sideEffecting, true);
  assert.equal(unknown.requiresApproval, true);
});

test("connector platform keeps credentials server-side and reuses canonical ToolRuntime approval", async () => {
  const [api, oauth, network, bridge, agent, migration] = await Promise.all([
    readFile(join(process.cwd(), "src/connectors/api.ts"), "utf8"),
    readFile(join(process.cwd(), "src/connectors/oauth.ts"), "utf8"),
    readFile(join(process.cwd(), "src/connectors/network.ts"), "utf8"),
    readFile(join(process.cwd(), "src/connectors/tool-bridge.ts"), "utf8"),
    readFile(join(process.cwd(), "src/chat/agent.ts"), "utf8"),
    readFile(join(process.cwd(), "migrations/017_connector_platform.sql"), "utf8"),
  ]);
  assert.match(api, /CredentialVault/u);
  assert.match(api, /NeonActorDatabase/u);
  assert.match(oauth, /code_challenge_method/u);
  assert.match(oauth, /oauth-protected-resource/u);
  assert.match(network, /OutboundNetworkPolicy/u);
  assert.match(network, /redirect: "error"/u);
  assert.match(bridge, /trustClass: "project"/u);
  assert.match(agent, /approval\.requested/u);
  assert.match(agent, /ToolRuntimeError/u);
  assert.doesNotMatch(bridge, /child_process|exec\(|spawn\(/u);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/u);
  assert.match(migration, /access_token_ciphertext/u);
});

test("connector security hardening preserves OAuth secrets and pins official overrides", async () => {
  const service = await readFile(join(process.cwd(), "src/connectors/service.ts"), "utf8");
  const store = await readFile(join(process.cwd(), "src/connectors/store.ts"), "utf8");
  const migration = await readFile(
    join(process.cwd(), "migrations/017_connector_platform.sql"),
    "utf8",
  );
  assert.match(service, /requestedUrl\.origin !== officialUrl\.origin/u);
  assert.match(service, /blockedTools/u);
  assert.match(store, /client_secret_ciphertext=COALESCE\(\$10,client_secret_ciphertext\)/u);
  assert.match(store, /metadata\.clientSecret/u);
  assert.doesNotMatch(migration, /UNIQUE\(owner_id,tool_name\)/u);
  assert.match(migration, /UNIQUE\(owner_id,connection_id,tool_name\)/u);
});
