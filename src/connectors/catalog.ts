import type { ConnectorDescriptor, ConnectorToolSummary, RemoteMcpTool } from "./types.js";
import { ConnectorError } from "./types.js";

const DEFAULT_READ = ["get_", "list_", "read_", "fetch_", "show_", "inspect_", "describe_"] as const;
const DEFAULT_SEARCH = ["search_", "find_", "query_"] as const;
const DEFAULT_WRITE = [
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

function broker(
  id: string,
  name: string,
  category: ConnectorDescriptor["category"],
  modes: readonly ("oauth" | "api_key" | "none")[],
  transports: readonly ("mcp" | "api")[],
  options: { readonly metered?: boolean; readonly description?: string } = {},
): ConnectorDescriptor {
  return Object.freeze({
    id,
    name,
    description: options.description ?? `${name} tools and data through Odin's connector gateway.`,
    category,
    runtime: "vercel_connect",
    transports,
    authModes: modes,
    vercelService: id,
    sourceUrl: `https://vercel.com/connect/${encodeURIComponent(id)}`,
    firstClass: false,
    policy: Object.freeze({
      defaultRisk: "high" as const,
      readPrefixes: DEFAULT_READ,
      searchPrefixes: DEFAULT_SEARCH,
      writePrefixes: DEFAULT_WRITE,
      alwaysApprovalPrefixes: DESTRUCTIVE,
      metered: options.metered === true,
    }),
  });
}

const FIRST_CLASS: readonly ConnectorDescriptor[] = Object.freeze([
  Object.freeze({
    id: "higgsfield",
    name: "Higgsfield",
    description: "Generate images, video, characters and creative assets through the official Higgsfield MCP.",
    category: "ai",
    runtime: "direct_mcp",
    transports: ["mcp"],
    authModes: ["oauth"],
    officialMcpUrl: "https://mcp.higgsfield.ai/mcp",
    sourceUrl: "https://higgsfield.ai/mcp",
    firstClass: true,
    policy: Object.freeze({
      defaultRisk: "high" as const,
      readPrefixes: ["get_", "list_", "read_"],
      searchPrefixes: ["search_", "find_"],
      writePrefixes: DEFAULT_WRITE,
      alwaysApprovalPrefixes: ["generate_", "create_", "render_", ...DESTRUCTIVE],
      metered: true,
    }),
  }),
  Object.freeze({
    id: "vercel",
    name: "Vercel",
    description: "Inspect projects and deployments and perform approved Vercel operations through the official MCP.",
    category: "developer",
    runtime: "direct_mcp",
    transports: ["mcp", "api"],
    authModes: ["oauth"],
    officialMcpUrl: "https://mcp.vercel.com",
    vercelService: "vercel",
    sourceUrl: "https://vercel.com/docs/agent-resources/vercel-mcp",
    firstClass: true,
    policy: Object.freeze({
      defaultRisk: "high" as const,
      readPrefixes: DEFAULT_READ,
      searchPrefixes: DEFAULT_SEARCH,
      writePrefixes: DEFAULT_WRITE,
      alwaysApprovalPrefixes: ["deploy_", "promote_", "rollback_", "set_", ...DESTRUCTIVE],
      metered: false,
    }),
  }),
  Object.freeze({
    id: "neon",
    name: "Neon",
    description: "Inspect and manage Neon Postgres projects through the official managed MCP with production-safe approvals.",
    category: "data",
    runtime: "direct_mcp",
    transports: ["mcp", "api"],
    authModes: ["oauth", "api_key"],
    officialMcpUrl: "https://mcp.neon.tech/mcp",
    vercelService: "neon",
    sourceUrl: "https://neon.com/docs/ai/neon-mcp-server",
    firstClass: true,
    policy: Object.freeze({
      defaultRisk: "high" as const,
      readPrefixes: ["list_", "get_", "describe_", "search_"],
      searchPrefixes: ["search_", "find_"],
      writePrefixes: ["create_", "update_", "run_", "execute_", "set_", "reset_"],
      alwaysApprovalPrefixes: ["run_sql", "execute_sql", "create_", "delete_", "drop_", "reset_", ...DESTRUCTIVE],
      metered: false,
    }),
  }),
]);

const BROKERED: readonly ConnectorDescriptor[] = Object.freeze([
  broker("github", "GitHub", "developer", ["oauth"], ["mcp", "api"]),
  broker("linear", "Linear", "productivity", ["oauth"], ["mcp", "api"]),
  broker("microsoft", "Microsoft 365", "productivity", ["oauth"], ["api"]),
  broker("salesforce", "Salesforce", "productivity", ["oauth"], ["api"]),
  broker("slack", "Slack", "communication", ["oauth"], ["api"]),
  broker("snowflake", "Snowflake", "data", ["oauth"], ["api"]),
  broker("agentmail", "AgentMail", "communication", ["api_key"], ["mcp", "api"]),
  broker("airtable", "Airtable", "productivity", ["oauth"], ["mcp", "api"]),
  broker("asana", "Asana", "productivity", ["oauth"], ["mcp", "api"]),
  broker("auth0", "Auth0", "developer", ["oauth"], ["api"]),
  broker("beehiiv", "beehiiv", "content", ["oauth", "api_key"], ["mcp", "api"]),
  broker("bitly", "Bitly", "content", ["oauth"], ["mcp", "api"]),
  broker("box", "Box", "productivity", ["oauth"], ["mcp", "api"]),
  broker("brex", "Brex", "commerce", ["oauth"], ["mcp", "api"]),
  broker("calendly", "Calendly", "productivity", ["oauth", "api_key"], ["api"]),
  broker("canva", "Canva", "content", ["oauth"], ["api"]),
  broker("clickhouse", "ClickHouse", "data", ["oauth"], ["mcp", "api"]),
  broker("clickup", "ClickUp", "productivity", ["oauth", "api_key"], ["api"]),
  broker("cloudflare", "Cloudflare", "developer", ["oauth"], ["mcp", "api"]),
  broker("cloudinary", "Cloudinary", "content", ["oauth"], ["mcp", "api"]),
  broker("coda", "Coda", "productivity", ["oauth"], ["mcp", "api"]),
  broker("convex", "Convex", "developer", ["oauth"], ["api"]),
  broker("databricks", "Databricks", "data", ["oauth"], ["api"]),
  broker("datadog", "Datadog", "developer", ["api_key"], ["api"]),
  broker("docusign", "DocuSign", "productivity", ["oauth"], ["api"]),
  broker("dropbox", "Dropbox", "productivity", ["oauth"], ["api"]),
  broker("figma", "Figma", "content", ["oauth"], ["api"]),
  broker("gitee", "Gitee", "developer", ["oauth"], ["api"]),
  broker("gitlab", "GitLab", "developer", ["oauth", "api_key"], ["api"]),
  broker("google", "Google", "productivity", ["oauth"], ["api"]),
  broker("harvest", "Harvest", "productivity", ["oauth"], ["api"]),
  broker("hubspot", "HubSpot", "productivity", ["oauth"], ["api"]),
  broker("hugging-face", "Hugging Face", "ai", ["oauth"], ["mcp", "api"], { metered: true }),
  broker("intercom", "Intercom", "communication", ["oauth"], ["api"]),
  broker("jira", "Jira", "productivity", ["oauth"], ["mcp", "api"]),
  broker("kernel", "Kernel", "developer", ["oauth", "api_key"], ["mcp", "api"]),
  broker("linkedin", "LinkedIn", "communication", ["oauth"], ["api"]),
  broker("make", "Make", "productivity", ["oauth"], ["mcp", "api"]),
  broker("mem0", "Mem0", "ai", ["oauth"], ["mcp", "api"]),
  broker("miro", "Miro", "productivity", ["oauth"], ["mcp", "api"]),
  broker("mixpanel", "Mixpanel", "analytics", ["oauth"], ["mcp", "api"]),
  broker("monday", "monday.com", "productivity", ["oauth", "api_key"], ["api"]),
  broker("netlify", "Netlify", "developer", ["oauth"], ["mcp", "api"]),
  broker("notion", "Notion", "productivity", ["oauth", "api_key"], ["mcp", "api"]),
  broker("okta", "Okta", "developer", ["oauth"], ["api"]),
  broker("pagerduty", "PagerDuty", "developer", ["oauth"], ["mcp", "api"]),
  broker("planetscale", "PlanetScale", "data", ["oauth"], ["mcp", "api"]),
  broker("posthog", "PostHog", "analytics", ["oauth"], ["mcp", "api"]),
  broker("postman", "Postman", "developer", ["oauth"], ["mcp", "api"]),
  broker("reddit", "Reddit", "communication", ["oauth"], ["api"]),
  broker("resend", "Resend", "communication", ["oauth", "api_key"], ["mcp", "api"]),
  broker("sanity", "Sanity", "content", ["oauth", "api_key"], ["mcp", "api"]),
  broker("sentry", "Sentry", "developer", ["oauth"], ["mcp", "api"]),
  broker("shopify", "Shopify", "commerce", ["oauth"], ["api"]),
  broker("spotify", "Spotify", "content", ["oauth"], ["api"]),
  broker("stripe", "Stripe", "commerce", ["oauth"], ["mcp", "api"]),
  broker("supabase", "Supabase", "data", ["oauth"], ["mcp", "api"]),
  broker("todoist", "Todoist", "productivity", ["oauth"], ["mcp", "api"]),
  broker("twitch", "Twitch", "content", ["oauth"], ["api"]),
  broker("typeform", "Typeform", "productivity", ["oauth", "api_key"], ["api"]),
  broker("webflow", "Webflow", "content", ["oauth", "api_key"], ["mcp", "api"]),
  broker("whoop", "WHOOP", "data", ["oauth"], ["api"]),
  broker("wix", "Wix", "content", ["oauth"], ["mcp", "api"]),
  broker("workday", "Workday", "productivity", ["oauth"], ["api"]),
  broker("xero", "Xero", "commerce", ["oauth"], ["mcp", "api"]),
  broker("zapier", "Zapier", "productivity", ["oauth"], ["mcp", "api"]),
  broker("zoom", "Zoom", "communication", ["oauth"], ["api"]),
]);

const CUSTOM: ConnectorDescriptor = Object.freeze({
  id: "custom-mcp",
  name: "Custom MCP",
  description: "Connect an approved HTTPS remote MCP using standard MCP OAuth discovery.",
  category: "developer",
  runtime: "custom_mcp",
  transports: ["mcp"],
  authModes: ["oauth", "api_key", "none"],
  sourceUrl: "https://modelcontextprotocol.io/",
  firstClass: false,
  policy: Object.freeze({
    defaultRisk: "high",
    readPrefixes: DEFAULT_READ,
    searchPrefixes: DEFAULT_SEARCH,
    writePrefixes: DEFAULT_WRITE,
    alwaysApprovalPrefixes: DESTRUCTIVE,
    metered: false,
  }),
});

export const CONNECTOR_CATALOG: readonly ConnectorDescriptor[] = Object.freeze(
  [...FIRST_CLASS, ...BROKERED, CUSTOM].sort((left, right) => left.name.localeCompare(right.name)),
);

const BY_ID = new Map(CONNECTOR_CATALOG.map((item) => [item.id, item] as const));

export function connectorDescriptor(id: string): ConnectorDescriptor {
  const descriptor = BY_ID.get(id);
  if (!descriptor) throw new ConnectorError("CATALOG_NOT_FOUND", "Connector is not in the Odin catalog.", 404);
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
    title: tool.title?.slice(0, 120) || tool.name,
    operation,
    riskClass,
    sideEffecting,
    requiresApproval,
  });
}
