import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { scope } from "./configure-vercel-preview.mjs";

export const runtimeSecretMappings = Object.freeze([
  Object.freeze({ target: "OPENAI_API_KEY", sources: Object.freeze(["OPENAI_API_KEY"]) }),
  Object.freeze({ target: "ANTHROPIC_API_KEY", sources: Object.freeze(["ANTHROPIC_API_KEY"]) }),
  Object.freeze({ target: "OPENROUTER_API_KEY", sources: Object.freeze(["OPENROUTER_API_KEY"]) }),
  Object.freeze({ target: "NV_API_KEY", sources: Object.freeze(["NV_API_KEY", "NVIDIA_API_KEY"]) }),
  Object.freeze({
    target: "NVIDIA_API_KEY",
    sources: Object.freeze(["NVIDIA_API_KEY", "NV_API_KEY"]),
  }),
]);

const forbiddenRuntimeKeys = new Set(["VERCEL_TOKEN", "NEON_API_KEY", "FREE_API_KEY"]);

export function collectRuntimeSecrets(env) {
  const variables = [];
  for (const mapping of runtimeSecretMappings) {
    assert(!forbiddenRuntimeKeys.has(mapping.target), `FORBIDDEN_RUNTIME_SECRET_${mapping.target}`);
    const value = mapping.sources.map((source) => env[source]).find((candidate) => candidate);
    if (!value) continue;
    assert.equal(typeof value, "string", `INVALID_${mapping.target}`);
    assert(!/[\r\n]/u.test(value), `INVALID_${mapping.target}`);
    variables.push({
      key: mapping.target,
      value,
      type: "sensitive",
      target: ["preview"],
      gitBranch: scope.gitBranch,
    });
  }
  return variables;
}

export function validateSecretSyncInvocation(env) {
  assert.equal(env.GITHUB_REPOSITORY, scope.repository, "REPOSITORY_SCOPE");
  assert.equal(env.GITHUB_REF, `refs/heads/${scope.gitBranch}`, "BRANCH_SCOPE");
  assert.match(env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/u, "HEAD_REQUIRED");
  assert(env.VERCEL_TOKEN && !/[\r\n]/u.test(env.VERCEL_TOKEN), "MISSING_VERCEL_TOKEN");
}

async function sync() {
  const report = {
    status: "INCOMPLETE",
    evaluatedAt: new Date().toISOString(),
    head: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    project: scope.project,
    branch: scope.gitBranch,
    synced: [],
    skipped: runtimeSecretMappings.map((mapping) => mapping.target),
    boundaries: [
      "Preview branch only; no production environment is modified",
      "Only runtime provider credentials are synchronized",
      "VERCEL_TOKEN and NEON_API_KEY remain GitHub control-plane secrets",
      "FREE_API_KEY remains unsynchronized until a verified inference endpoint/provider identity exists",
      "Secret values are never printed or written to artifacts",
      "A fresh preview deployment is created only after the environment writes complete",
    ],
  };
  let stage = "invocation";
  try {
    validateSecretSyncInvocation(process.env);
    const variables = collectRuntimeSecrets(process.env);
    const api = async (path, method = "GET", body) => {
      const response = await fetch(
        `https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${scope.team}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
            "Content-Type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        },
      );
      assert(response.ok, `VERCEL_HTTP_${response.status}`);
      return response.json();
    };

    stage = "project scope";
    const project = await api(`/v9/projects/${scope.project}`);
    assert.equal(project.id, scope.project);
    assert.equal(project.accountId, scope.team);
    assert.equal(project.name, "odin-agent");
    assert.equal(Number(project.link?.repoId), scope.repoId);

    stage = "runtime secret sync";
    for (const variable of variables) {
      const result = await api(`/v10/projects/${scope.project}/env?upsert=true`, "POST", variable);
      assert.equal(result.failed?.length ?? 0, 0, "ENV_WRITE_FAILED");
      report.synced.push(variable.key);
    }
    report.skipped = report.skipped.filter((key) => !report.synced.includes(key));

    stage = "fresh preview deployment";
    const deployment = await api("/v13/deployments", "POST", {
      name: "odin-agent",
      project: scope.project,
      gitSource: {
        type: "github",
        repoId: scope.repoId,
        ref: scope.gitBranch,
        sha: process.env.GITHUB_SHA,
      },
    });
    assert.equal(deployment.target ?? null, null, "PRODUCTION_TARGET_FORBIDDEN");
    assert.match(deployment.id ?? "", /^dpl_[A-Za-z0-9]+$/u, "DEPLOYMENT_ID_REQUIRED");
    assert.match(
      deployment.url ?? "",
      /^odin-agent-[a-z0-9-]+\.vercel\.app$/u,
      "DEPLOYMENT_URL_REQUIRED",
    );
    report.deployment = {
      id: deployment.id,
      url: `https://${deployment.url}`,
      state: deployment.readyState,
    };
    report.status = "PASS_DEPLOYMENT_PENDING";
  } catch (error) {
    report.status = "FAILED";
    report.failure = {
      stage,
      code:
        typeof error?.code === "string" && /^[A-Z_0-9]{1,80}$/u.test(error.code)
          ? error.code
          : "CHECK_FAILED",
    };
    process.exitCode = 1;
  } finally {
    const output = JSON.stringify(report, null, 2);
    await writeFile("vercel-secret-sync-result.json", `${output}\n`);
    process.stdout.write(`${output}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await sync();
