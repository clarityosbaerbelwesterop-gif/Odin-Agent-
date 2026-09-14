import type { ConnectorDescriptor, ConnectorToolSummary, RemoteMcpTool } from "./types.js";
import { ConnectorError } from "./types.js";

const READ = ["get_", "list_", "read_", "fetch_", "show_", "inspect_", "describe_"] as const;
const SEARCH = ["search_", "find_", "query_"] as const;
const WRITE = [
  "create_",
  "update_",
  "set_",
  "send_",
  "post_",
  "publish_",
  "deploy_",
  "run_",
  "execute_",
  "start_",
  "trigger_",
  "upload_",
  "write_",
  "share_",
  "connect_",
] as const;
const DESTRUCTIVE = [
  "delete_",
  "remove_",
  "destroy_",
  "drop_",
  "revoke_",
  "rollback_",
  "merge_",
  "promote_",
  "purchase_",
  "pay_",
  "subscribe_",
] as const;

const FIRST_CLASS: readonly ConnectorDescriptor[] = Object.freeze([
  Object.freeze<ConnectorDescriptor>({
    id: "neon",
    name: "Neon",
    description: "Neon Postgres projects, branches, schema and queries through Neon's managed MCP.",
    category: "data",
    runtime: "direct_mcp",
    transports: ["mcp"],
    authModes: ["oauth", "api_key"],
    officialMcpUrl: "https://mcp.neon.tech/mcp?readonly=true",
    allowEndpointOverride: true,
    sourceUrl: "https://github.com/neondatabase/mcp-server-neon",
    firstClass: true,
    trust: "official",
    defaultScopes: ["read"],
    safetyNote:
      "Read-only by default. Full Neon write access is an explicit escalation and high-impact tools require approval.",
    policy: Object.freeze({
      defaultRisk: "high" as const,
      readPrefixes: [...READ, "prepare_database_migration", "explain_sql_statement"],
      searchPrefixes: SEARCH,
      writePrefixes: [...WRITE, "run_sql", "run_sql_transaction", "apply_database_migration"],
      alwaysApprovalPrefixes: [
        "run_sql",
        "run_sql_transaction",
        "apply_database_migration",
        ...DESTRUCTIVE,
      ],
      metered: false,
    }),
  }),
  Object.freeze<ConnectorDescriptor>({
    id: "vercel",
    name: "Vercel",
    description:
      "Projects, deployments, logs and documentation through Vercel's official remote MCP.",
    category: "developer",
    runtime: "direct_mcp",
    transports: ["mcp"],
    authModes: ["oauth"],
    officialMcpUrl: "https://mcp.vercel.com",
    sourceUrl: "https://vercel.com/docs/mcp/vercel-mcp",
    firstClass: true,
    trust: "official",
    safetyNote:
      "OAuth is handled by Vercel. Unknown or future write tools remain high risk and require approval.",
    policy: Object.freeze({
      defaultRisk: "high" as const,
      readPrefixes: READ,
      searchPrefixes: SEARCH,
      writePrefixes: WRITE,
      alwaysApprovalPrefixes: ["deploy_", "promote_", "rollback_", "set_", ...DESTRUCTIVE],
      metered: false,
    }),
  }),
  Object.freeze<ConnectorDescriptor>({
    id: "google-workspace",
    name: "Google Workspace MCP",
    description:
      "Gmail, Drive, Calendar, Docs, Sheets and other Workspace services through the requested open-source MCP server.",
    category: "productivity",
    runtime: "direct_mcp",
    transports: ["mcp"],
    authModes: ["oauth"],
    sourceUrl: "https://github.com/taylorwilsdon/google_workspace_mcp",
    firstClass: true,
    trust: "community",
    endpointRequired: true,
    safetyNote:
      "Connect an HTTPS deployment you control. Sending mail, sharing files and other writes require Odin approval.",
    policy: Object.freeze({
      defaultRisk: "high" as const,
      readPrefixes: READ,
      searchPrefixes: SEARCH,
      writePrefixes: WRITE,
      alwaysApprovalPrefixes: ["send_", "share_", "publish_", "execute_", ...DESTRUCTIVE],
      metered: false,
    }),
  }),
  Object.freeze<ConnectorDescriptor>({
    id: "linkedin",
    name: "LinkedIn MCP",
    description:
      "Profiles, companies, jobs and messaging through the requested community LinkedIn MCP server.",
    category: "communication",
    runtime: "direct_mcp",
    transports: ["mcp"],
    authModes: ["none", "api_key"],
    sourceUrl: "https://github.com/stickerdaniel/linkedin-mcp-server",
    firstClass: true,
    trust: "community",
    endpointRequired: true,
    safetyNote:
      "Odin never imports LinkedIn browser cookies. Connect a self-hosted HTTPS MCP endpoint; connection requests and messages require approval.",
    policy: Object.freeze({
      defaultRisk: "high" as const,
      readPrefixes: [...READ, "get_my_profile", "get_person_profile"],
      searchPrefixes: SEARCH,
      writePrefixes: [...WRITE, "connect_with_person", "send_message"],
      alwaysApprovalPrefixes: ["connect_with_person", "send_message", ...DESTRUCTIVE],
      metered: false,
    }),
  }),
]);

const CUSTOM: ConnectorDescriptor = Object.freeze<ConnectorDescriptor>({
  id: "custom-mcp",
  name: "Custom MCP",
  description:
    "Connect a public HTTPS MCP endpoint with standard MCP OAuth, bearer auth, or no auth.",
  category: "developer",
  runtime: "custom_mcp",
  transports: ["mcp"],
  authModes: ["oauth", "api_key", "none"],
  sourceUrl: "https://modelcontextprotocol.io/",
  firstClass: false,
  trust: "community",
  endpointRequired: true,
  safetyNote:
    "Custom server descriptions and output are untrusted data. Unknown tools are high risk by default.",
  policy: Object.freeze({
    defaultRisk: "high",
    readPrefixes: READ,
    searchPrefixes: SEARCH,
    writePrefixes: WRITE,
    alwaysApprovalPrefixes: DESTRUCTIVE,
    metered: false,
  }),
});

export const CONNECTOR_CATALOG: readonly ConnectorDescriptor[] = Object.freeze(
  [...FIRST_CLASS, CUSTOM].sort((left, right) => left.name.localeCompare(right.name)),
);

const BY_ID = new Map(CONNECTOR_CATALOG.map((item) => [item.id, item] as const));

export function connectorDescriptor(id: string): ConnectorDescriptor {
  const descriptor = BY_ID.get(id);
  if (!descriptor)
    throw new ConnectorError("CATALOG_NOT_FOUND", "Connector is not in the Odin catalog.", 404);
  return descriptor;
}

function begins(name: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => name === prefix || name.startsWith(prefix));
}

function namespaceTool(connectorId: string, remoteName: string): string {
  const safe = remoteName
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 120);
  if (!safe) throw new ConnectorError("MCP_TOOL_DENIED", "Remote MCP tool name is invalid.");
  return `connector.${connectorId}.${safe}`;
}

export function classifyRemoteTool(
  descriptor: ConnectorDescriptor,
  tool: RemoteMcpTool,
): ConnectorToolSummary {
  const name = tool.name.toLowerCase();
  let operation: ConnectorToolSummary["operation"] = "execute";
  let riskClass: ConnectorToolSummary["riskClass"] = descriptor.policy.defaultRisk;
  let sideEffecting = true;
  let requiresApproval = true;

  if (begins(name, descriptor.policy.alwaysApprovalPrefixes)) {
    operation = "write";
    riskClass = "high";
  } else if (begins(name, descriptor.policy.searchPrefixes)) {
    operation = "search";
    riskClass = "medium";
    sideEffecting = false;
    requiresApproval = false;
  } else if (begins(name, descriptor.policy.readPrefixes)) {
    operation = "read";
    riskClass = "medium";
    sideEffecting = false;
    requiresApproval = false;
  } else if (begins(name, descriptor.policy.writePrefixes)) {
    operation = "write";
    riskClass = "high";
  }

  if (descriptor.policy.metered && sideEffecting) {
    riskClass = "high";
    requiresApproval = true;
  }

  return Object.freeze({
    remoteName: tool.name,
    toolName: namespaceTool(descriptor.id, tool.name),
    title: (tool.title ?? tool.name).slice(0, 200),
    operation,
    riskClass,
    sideEffecting,
    requiresApproval,
  });
}
