import { writeFile } from "node:fs/promises";

const PROJECT_ID = "cold-mode-01560070";
const BRANCH_ID = "br-muddy-boat-b1po0mwo";
const API = `https://console.neon.tech/api/v2/projects/${PROJECT_ID}/branches/${BRANCH_ID}/auth/oauth_providers`;
const RESULT_FILE = "neon-github-auth-result.json";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required production mapping: ${name}`);
  return value;
}

function providersOf(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    if (Array.isArray(value.oauth_providers)) return value.oauth_providers;
    if (Array.isArray(value.providers)) return value.providers;
  }
  return [];
}

const neonApiKey = required("NEON_API_KEY");
const clientId = required("GITHUB_OAUTH_CLIENT_ID");
const clientSecret = required("GITHUB_OAUTH_CLIENT_SECRET");

async function neon(path = "", init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${neonApiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`Neon Auth OAuth provider request failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

const before = await neon();
const exists = providersOf(before).some((provider) => provider?.id === "github");
const payload = JSON.stringify({
  id: "github",
  client_id: clientId,
  client_secret: clientSecret,
});

if (exists) {
  await neon("/github", { method: "PATCH", body: payload });
} else {
  await neon("", { method: "POST", body: payload });
}

const after = await neon();
const configured = providersOf(after).some((provider) => provider?.id === "github");
if (!configured) throw new Error("Neon Auth did not confirm the GitHub OAuth provider.");

const result = {
  configured: true,
  provider: "github",
  action: exists ? "updated" : "added",
  projectId: PROJECT_ID,
  branchId: BRANCH_ID,
  verifiedAt: new Date().toISOString(),
};
await writeFile(RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(
  `Neon Auth GitHub provider ${result.action} and verified without exposing credentials.`,
);
