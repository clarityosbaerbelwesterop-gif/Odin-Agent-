import type { IncomingMessage, ServerResponse } from "node:http";
import { attachDatabasePool } from "@vercel/functions";
import { canonicalJson } from "../durable/internal.js";
import { resolveNeonAuthUrl } from "./deployment.js";
import { NeonAuth } from "./neon-auth.js";
import { createNeonPool, NeonActorDatabase } from "./neon-database.js";
import { hashText, publicError } from "./safety.js";
import { SkillProductStore } from "./skill-product-store.js";
import {
  assertInstallRequest,
  draftCustomSkill,
  parseProjectId,
  parseScope,
  productSkillById,
  projectSkillCatalog,
} from "./skills-product.js";
import { ChatError } from "./types.js";

let services: ReturnType<typeof createServices> | undefined;

function createServices() {
  const connection =
    process.env.ODIN_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  const authUrl = resolveNeonAuthUrl(connection, process.env);
  if (!connection || !authUrl)
    throw new ChatError(
      "BACKEND_CONFIG",
      "Neon database and Auth must be configured for this deployment.",
      503,
    );
  const pool = createNeonPool(connection);
  attachDatabasePool(pool);
  return { pool, auth: new NeonAuth(authUrl) };
}

export async function skillsApiHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  try {
    const origin = allowedOrigin(req);
    const method = req.method ?? "GET";
    if (!["GET", "HEAD"].includes(method) && req.headers["x-odin-request"] !== "1")
      throw new ChatError("CSRF_DENIED", "Missing same-origin request header.", 403);
    const url = new URL(req.url ?? "/", origin);
    if (url.pathname === "/api" && url.searchParams.has("odin_path"))
      url.pathname = `/api/${url.searchParams.get("odin_path")}`;
    if (url.pathname !== "/api/skills" && !url.pathname.startsWith("/api/skills/"))
      throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);

    services ??= createServices();
    const identity = await services.auth.session(req.headers.cookie ?? "", origin);
    const db = new NeonActorDatabase(services.pool, identity);
    const store = new SkillProductStore(db);
    const connections = await store.connections();

    if (url.pathname === "/api/skills" && method === "GET") {
      const projectId = optionalProject(url.searchParams.get("projectId"));
      if (projectId) await store.requireProject(projectId);
      const [installations, drafts] = await Promise.all([
        store.installations(projectId),
        store.drafts(projectId),
      ]);
      send(res, 200, {
        skills: projectSkillCatalog(installations, connections, projectId),
        drafts,
        connections,
        policy: {
          installDoesNotGrantAuthority: true,
          executionAuthority: "M23 Skill OS + M25 Tool Policy",
          verificationAuthority: "M10 Skill Registry",
          credentialsRemainServerSide: true,
        },
      });
      return;
    }

    const detail = /^\/api\/skills\/catalog\/([a-z0-9-]+)$/u.exec(url.pathname);
    if (detail && method === "GET") {
      const projectId = optionalProject(url.searchParams.get("projectId"));
      if (projectId) await store.requireProject(projectId);
      const skill = productSkillById(detail[1] ?? "");
      const installations = await store.installations(projectId);
      const projection = projectSkillCatalog(installations, connections, projectId).find(
        (candidate) => candidate.id === skill.id,
      );
      send(res, 200, { skill: projection });
      return;
    }

    if (url.pathname === "/api/skills/install" && method === "POST") {
      const body = await jsonObject(req);
      const skill = productSkillById(text(body.skillId, "skillId"));
      const target = assertInstallRequest(
        skill,
        {
          version: body.version,
          contentHash: body.contentHash,
          scope: body.scope,
          projectId: body.projectId,
        },
        connections,
      );
      if (target.projectId) await store.requireProject(target.projectId);
      const installation = await store.install({
        skillId: skill.id,
        version: skill.version,
        contentHash: skill.contentHash,
        scope: target.scope,
        projectId: target.projectId,
      });
      send(res, 201, {
        installation,
        authorityGranted: false,
        note: "Installation changes product availability only; runtime/tool/credential authority is unchanged.",
      });
      return;
    }

    if (url.pathname === "/api/skills/state" && method === "POST") {
      const body = await jsonObject(req);
      const skill = productSkillById(text(body.skillId, "skillId"));
      const scope = parseScope(body.scope);
      const projectId = scope === "project" ? parseProjectId(body.projectId) : null;
      if (projectId) await store.requireProject(projectId);
      if (typeof body.enabled !== "boolean")
        throw new ChatError("INVALID_SKILL_STATE", "enabled must be boolean.");
      const current = await store.installation(skill.id, scope, projectId);
      if (!current) throw new ChatError("SKILL_NOT_INSTALLED", "Skill is not installed.", 404);
      if (body.expectedContentHash !== current.contentHash)
        throw new ChatError(
          "SKILL_INTEGRITY",
          "Skill installation changed before the state update.",
          409,
        );
      if (body.enabled) {
        const missing = skill.requiredConnections.filter((name) => !connections[name]);
        if (missing.length)
          throw new ChatError(
            "SKILL_CONNECTION_REQUIRED",
            `Connect ${missing.join(", ")} first.`,
            409,
          );
      }
      send(res, 200, {
        installation: await store.setEnabled(skill.id, scope, projectId, body.enabled),
        authorityGranted: false,
      });
      return;
    }

    if (url.pathname === "/api/skills/update" && method === "POST") {
      const body = await jsonObject(req);
      const skill = productSkillById(text(body.skillId, "skillId"));
      const scope = parseScope(body.scope);
      const projectId = scope === "project" ? parseProjectId(body.projectId) : null;
      if (projectId) await store.requireProject(projectId);
      if (typeof body.expectedContentHash !== "string")
        throw new ChatError("SKILL_INTEGRITY", "Expected installation hash is required.");
      const missing = skill.requiredConnections.filter((name) => !connections[name]);
      if (missing.length)
        throw new ChatError(
          "SKILL_CONNECTION_REQUIRED",
          `Connect ${missing.join(", ")} first.`,
          409,
        );
      send(res, 200, {
        installation: await store.update({
          skillId: skill.id,
          version: skill.version,
          contentHash: skill.contentHash,
          scope,
          projectId,
          expectedContentHash: body.expectedContentHash,
        }),
        authorityGranted: false,
      });
      return;
    }

    if (url.pathname === "/api/skills/rollback" && method === "POST") {
      const body = await jsonObject(req);
      const skill = productSkillById(text(body.skillId, "skillId"));
      const scope = parseScope(body.scope);
      const projectId = scope === "project" ? parseProjectId(body.projectId) : null;
      if (projectId) await store.requireProject(projectId);
      if (typeof body.expectedContentHash !== "string")
        throw new ChatError("SKILL_INTEGRITY", "Expected installation hash is required.");
      send(res, 200, {
        installation: await store.rollback(skill.id, scope, projectId, body.expectedContentHash),
        authorityGranted: false,
      });
      return;
    }

    if (url.pathname === "/api/skills/install" && method === "DELETE") {
      const body = await jsonObject(req);
      const skill = productSkillById(text(body.skillId, "skillId"));
      const scope = parseScope(body.scope);
      const projectId = scope === "project" ? parseProjectId(body.projectId) : null;
      if (projectId) await store.requireProject(projectId);
      const current = await store.installation(skill.id, scope, projectId);
      if (!current) throw new ChatError("SKILL_NOT_INSTALLED", "Skill is not installed.", 404);
      if (body.expectedContentHash !== current.contentHash)
        throw new ChatError("SKILL_INTEGRITY", "Skill installation changed before removal.", 409);
      await store.remove(skill.id, scope, projectId);
      send(res, 200, { removed: true, authorityGranted: false });
      return;
    }

    if (url.pathname === "/api/skills/custom" && method === "POST") {
      const body = await jsonObject(req);
      const scope = parseScope(body.scope);
      const projectId = scope === "project" ? parseProjectId(body.projectId) : null;
      if (projectId) await store.requireProject(projectId);
      const draft = draftCustomSkill({
        goal: text(body.goal, "goal"),
        scope,
        projectId,
      });
      const saved = await store.saveDraft(draft);
      send(res, 201, {
        draft: saved,
        loadable: false,
        authorityGranted: false,
        nextGate:
          "Independent validation and verification are required before M23 may select this Skill.",
      });
      return;
    }

    const run = /^\/api\/skills\/runs\/([0-9a-f-]{36})$/iu.exec(url.pathname);
    if (run && method === "GET") {
      const runId = run[1] ?? "";
      const projectId = parseProjectId(url.searchParams.get("projectId"));
      const after = eventCursor(url.searchParams.get("after"));
      await store.requireRunProject(projectId, runId);
      const events = await db.transaction(async (client) =>
        (
          await client.query(
            `SELECT cursor,type,data,data_hash,created_at
               FROM odin_api.events
              WHERE conversation_id=$1::uuid AND turn_id=$2::uuid AND cursor>$3
                AND type IN (
                  'skill.selected','skill.loaded','skill.result',
                  'skill.connection_required','skill.verification_failed'
                )
              ORDER BY cursor ASC
              LIMIT 128`,
            [projectId, runId, after],
          )
        ).rows,
      );
      const evidence = events.map((event) => {
        const data = eventData(event);
        return {
          cursor: Number(event.cursor),
          type: String(event.type),
          data,
          createdAt: new Date(String(event.created_at)).toISOString(),
        };
      });
      send(res, 200, {
        projectId,
        runId,
        evidence,
        nextCursor: evidence.at(-1)?.cursor ?? after,
        note:
          evidence.length > 0
            ? "Only canonical server-side Skill runtime events are shown."
            : "No canonical Skill runtime evidence is attached to this Run; no Skill usage is fabricated.",
      });
      return;
    }

    throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);
  } catch (error) {
    send(res, error instanceof ChatError ? error.status : 500, publicError(error));
  }
}

function allowedOrigin(req: IncomingMessage): string {
  const host = req.headers.host ?? "";
  const configured = [
    process.env.ODIN_PUBLIC_ORIGIN,
    ...[
      process.env.VERCEL_URL,
      process.env.VERCEL_BRANCH_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
    ]
      .filter(Boolean)
      .map((value) => `https://${value}`),
  ].filter((value): value is string => Boolean(value));
  const origin = `https://${host}`;
  if (
    !configured.includes(origin) ||
    (req.headers.origin && req.headers.origin !== origin) ||
    req.headers["sec-fetch-site"] === "cross-site"
  )
    throw new ChatError("ORIGIN_DENIED", "Unrecognized application origin.", 403);
  return origin;
}

function optionalProject(value: string | null): string | null {
  if (!value) return null;
  return parseProjectId(value);
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new ChatError("INVALID_SKILL", `${name} is required.`);
  return value.trim();
}

function eventCursor(value: string | null): number {
  if (value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new ChatError("INVALID_CURSOR", "Skill event cursor is invalid.");
  return parsed;
}

function eventData(row: Record<string, unknown>): Record<string, unknown> {
  const data = row.data;
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new ChatError("INTEGRITY_FAILURE", "Stored Skill event is invalid.", 500);
  if (hashText(canonicalJson(data, 300000)) !== row.data_hash)
    throw new ChatError("INTEGRITY_FAILURE", "Stored Skill event failed verification.", 500);
  return data as Record<string, unknown>;
}

async function jsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (
    !String(req.headers["content-type"] ?? "")
      .toLowerCase()
      .startsWith("application/json")
  )
    throw new ChatError("CONTENT_TYPE", "Use an application/json request body.", 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024)
      throw new ChatError("PAYLOAD_TOO_LARGE", "Skill request is too large.", 413);
    chunks.push(buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new ChatError("INVALID_JSON", "Request body must be a JSON object.");
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
