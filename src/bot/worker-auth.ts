import { createRemoteJWKSet, jwtVerify } from "jose";
import { ChatError } from "../chat/types.js";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "odin-bot-worker";
const REPOSITORY = "clarityosbaerbelwesterop-gif/Odin-Agent-";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

export async function verifyBotSchedulerAuthorization(header: string | undefined): Promise<void> {
  const match = /^Bearer\s+(.+)$/u.exec(header ?? "");
  const token = match?.[1];
  if (!token)
    throw new ChatError("BOT_WORKER_UNAUTHORIZED", "Worker authorization is required.", 401);
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["RS256"],
    });
    if (
      payload.repository !== REPOSITORY ||
      payload.ref !== "refs/heads/main" ||
      !["schedule", "workflow_dispatch"].includes(String(payload.event_name ?? "")) ||
      typeof payload.workflow_ref !== "string" ||
      !payload.workflow_ref.startsWith(
        `${REPOSITORY}/.github/workflows/odin-bot-scheduler.yml@refs/heads/main`,
      )
    )
      throw new Error("claim mismatch");
  } catch {
    throw new ChatError("BOT_WORKER_UNAUTHORIZED", "Worker authorization is invalid.", 401);
  }
}
