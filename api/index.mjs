// Vercel compiles TypeScript functions in an isolated transpilation step after the
// repository build. Keep the deployment wrapper JavaScript-only and import the
// already typechecked build artifact so the canonical `npm run build` remains the
// sole TypeScript compilation path.
import { browserApiHandler } from "../dist/src/chat/browser-api.js";
import { buildApiHandler } from "../dist/src/chat/build-api.js";
import { codingApiHandler } from "../dist/src/chat/coding-api.js";
import { hostedHandler } from "../dist/src/chat/hosted.js";
import { memoryApiHandler } from "../dist/src/chat/memory-api.js";
import { productReleaseReadiness } from "../dist/src/chat/release-readiness.js";
import { createSharedHostedModels } from "../dist/src/chat/server-models.js";
import { skillsApiHandler } from "../dist/src/chat/skills-api.js";
import { workspaceApiHandler } from "../dist/src/chat/workspace-api.js";

const releaseReadiness = productReleaseReadiness(
  process.env,
  createSharedHostedModels(process.env).length,
);
console.info("Odin product release readiness", releaseReadiness);

export default async function handler(req, res) {
  const url = new URL(req.url ?? "/", "https://odin.invalid");
  const rewrittenPath = url.searchParams.get("odin_path") ?? "";
  if (rewrittenPath === "browser" || rewrittenPath.startsWith("browser/"))
    return browserApiHandler(req, res);
  if (rewrittenPath === "build" || rewrittenPath.startsWith("build/"))
    return buildApiHandler(req, res);
  if (rewrittenPath === "coding" || rewrittenPath.startsWith("coding/"))
    return codingApiHandler(req, res);
  if (rewrittenPath === "workspace" || rewrittenPath.startsWith("workspace/"))
    return workspaceApiHandler(req, res);
  if (rewrittenPath === "memory" || rewrittenPath.startsWith("memory/"))
    return memoryApiHandler(req, res);
  if (rewrittenPath === "skills" || rewrittenPath.startsWith("skills/"))
    return skillsApiHandler(req, res);
  return hostedHandler(req, res);
}
