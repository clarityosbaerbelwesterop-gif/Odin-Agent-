import { hostedHandler } from "../dist/src/chat/hosted.js";

/**
 * GitHub returns repository OAuth as a cross-site top-level GET. The main API
 * intentionally rejects cross-site requests before route dispatch, so this
 * dedicated bridge admits only that one callback shape and then hands it to
 * the normal hosted handler where the authenticated actor and one-time OAuth
 * state are still verified before any token is stored.
 */
export default async function githubCallback(req, res) {
  if ((req.method ?? "GET") !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        code: "METHOD_NOT_ALLOWED",
        message: "GitHub OAuth callback requires GET.",
      }),
    );
    return;
  }

  const host = req.headers.host ?? "";
  if (!host) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({ code: "INVALID_CALLBACK", message: "Invalid GitHub OAuth callback." }),
    );
    return;
  }

  const incoming = new URL(req.url ?? "/api/github-callback", `https://${host}`);
  const callback = new URL("/api", `https://${host}`);
  callback.searchParams.set("odin_path", "github/callback");
  for (const [key, value] of incoming.searchParams) callback.searchParams.append(key, value);

  // This endpoint is intentionally the only cross-site navigation admitted.
  // OAuth state remains mandatory and actor-scoped in hostedHandler.
  delete req.headers["sec-fetch-site"];
  delete req.headers.origin;
  req.url = `${callback.pathname}${callback.search}`;
  await hostedHandler(req, res);
}
