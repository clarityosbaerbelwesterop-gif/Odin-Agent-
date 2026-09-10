import { readFile, writeFile } from "node:fs/promises";

const load = (path) => readFile(path, "utf8");
function one(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing integration anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0)
    throw new Error(`Ambiguous integration anchor: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}
function regex(source, pattern, after, label) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) throw new Error(`Expected one ${label} anchor, found ${matches.length}`);
  return source.replace(pattern, after);
}

let hosted = await load("src/chat/hosted.ts");
hosted = one(
  hosted,
  'import { attachDatabasePool } from "@vercel/functions";',
  'import { attachDatabasePool, waitUntil } from "@vercel/functions";',
  "Vercel waitUntil import",
);
hosted = one(
  hosted,
  'import { GitHubWorkspace } from "./github-workspace.js";',
  'import { GitHubCatalog } from "./github-catalog.js";\nimport { GitHubWorkspace } from "./github-workspace.js";',
  "GitHub catalog import",
);
hosted = one(
  hosted,
  `    if (url.pathname === "/api/auth/config") {
      send(res, 200, { provider: "neon", emailVerificationRequired: true });
      return;
    }`,
  `    if (url.pathname === "/api/auth/config") {
      send(res, 200, {
        provider: "neon",
        emailVerificationRequired: true,
        oauth: {
          github: { available: false },
        },
      });
      return;
    }`,
  "auth capability response",
);
hosted = one(
  hosted,
  `        workspace: {
          connected: true,
          writable: true,
          kind: "static-web",
          quality: "Syntax checks only; browser execution is isolated in the preview.",
        },`,
  `        workspace: githubWorkspaceReady
          ? {
              connected: true,
              writable: true,
              kind: "github",
              account: githubConnection.login,
              repository: githubConnection.repository,
              branch: githubConnection.defaultBranch,
              quality: "Changes run on an isolated Odin branch and require repository checks.",
            }
          : {
              connected: false,
              writable: false,
              kind: "github",
              account: githubConnection.connected ? githubConnection.login : null,
              repository: null,
              branch: null,
              quality: "Connect GitHub and choose a repository before starting Coding mode.",
            },`,
  "canonical workspace response",
);
hosted = one(
  hosted,
  `    if (url.pathname === "/api/github/repositories" && method === "GET") {
      const token = await product.githubToken();
      if (!token) throw new ChatError("GITHUB_NOT_CONNECTED", "Connect GitHub first.", 409);
      const repositories = (await github(
        token,
        "/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=updated",
      )) as unknown[];
      send(res, 200, { repositories: repositories.map(publicRepository) });
      return;
    }
    if (url.pathname === "/api/github/repository" && method === "PUT") {
      const body = object(await jsonBody(req), ["repository", "branch"]);
      await product.selectRepository(String(body.repository ?? ""), String(body.branch ?? ""));
      send(res, 200, await product.github());
      return;
    }`,
  `    if (url.pathname === "/api/github/repositories" && method === "GET") {
      const token = await product.githubToken();
      if (!token) throw new ChatError("GITHUB_NOT_CONNECTED", "Connect GitHub first.", 409);
      send(res, 200, { repositories: await new GitHubCatalog(token).repositories() });
      return;
    }
    if (url.pathname === "/api/github/branches" && method === "GET") {
      const token = await product.githubToken();
      if (!token) throw new ChatError("GITHUB_NOT_CONNECTED", "Connect GitHub first.", 409);
      const repository = url.searchParams.get("repository") ?? "";
      send(res, 200, { branches: await new GitHubCatalog(token).branches(repository) });
      return;
    }
    if (url.pathname === "/api/github/repository" && method === "PUT") {
      const body = object(await jsonBody(req), ["repository", "branch"]);
      const token = await product.githubToken();
      if (!token) throw new ChatError("GITHUB_NOT_CONNECTED", "Connect GitHub first.", 409);
      const verified = await new GitHubCatalog(token).verifySelection(
        String(body.repository ?? ""),
        String(body.branch ?? ""),
      );
      await product.selectRepository(verified.repository.fullName, verified.branch.name);
      send(res, 200, await product.github());
      return;
    }`,
  "repository catalog routes",
);
hosted = regex(
  hosted,
  /      if \(turn\[2\] === "run" && method === "POST"\) \{[\s\S]*?        return;\n      \}\n    \}\n    throw new ChatError\("NOT_FOUND"/u,
  `      if (turn[2] === "run" && method === "POST") {
        await jsonBody(req);
        const resource = \`run:\${id}\`;
        const lease = await db.claim(resource);
        if (!lease) throw new ChatError("BUSY", "This task already has an active worker.", 409);
        const run = (async () => {
          const controller = new AbortController();
          const workerDb = new NeonActorDatabase(pool, identity, { resource, token: lease });
          const worker = createEngine(workerDb, found.conversationId, controller.signal);
          let checking = false;
          const monitor = setInterval(() => {
            if (checking) return;
            checking = true;
            void (async () => {
              try {
                const view = await engine.view(id);
                if (["PAUSED", "CANCELLED", "BLOCKED", "FAILED"].includes(view.state))
                  controller.abort();
              } catch {
                controller.abort();
              } finally {
                checking = false;
              }
            })();
          }, 1000);
          try {
            await worker.execute(id);
          } finally {
            clearInterval(monitor);
            await db.release(resource, lease);
          }
        })();
        // A browser reload must not cancel server-side work. Vercel owns the bounded promise
        // after this acknowledgement and the database lease fences duplicate workers.
        waitUntil(run);
        send(res, 202, { accepted: true, turn: await engine.view(id) });
        return;
      }
    }
    throw new ChatError("NOT_FOUND"`,
  "hosted run route",
);
hosted = regex(
  hosted,
  /\nfunction publicRepository\(value: unknown\) \{[\s\S]*?\n\}\nasync function verifyProviderKey/u,
  "\nasync function verifyProviderKey",
  "legacy repository mapper",
);
await writeFile("src/chat/hosted.ts", hosted);

let chat = await load("web/chat.js");
chat = one(
  chat,
  `    if (response.status === 401 && !$("login").open) {
      resetSession();
      $("login").showModal();
    }`,
  `    if (response.status === 401) {
      resetSession();
      if (authProvider === "local") {
        if (!$("login").open) $("login").showModal();
      } else {
        const returnTo = \`\${window.location.pathname}\${window.location.search}\`;
        window.location.assign(\`/login?returnTo=\${encodeURIComponent(returnTo)}\`);
      }
    }`,
  "hosted unauthorized redirect",
);
chat = one(
  chat,
  `  stream.onopen = () => {
    $("connection").textContent = "Connected";
  };`,
  `  stream.onopen = () => {
    $("connection").textContent = "Connected";
    if (active && !terminal.has(active.state) && active.state !== "PAUSED") startExecution(active);
  };`,
  "stream recovery",
);
chat = one(
  chat,
  `  if (active?.state === "CREATED") startExecution(active);`,
  `  if (active && !terminal.has(active.state) && active.state !== "PAUSED") startExecution(active);`,
  "reload recovery",
);
chat = one(
  chat,
  `    resetSession();
    $("login").showModal();`,
  `    resetSession();
    if (authProvider === "local") $("login").showModal();
    else window.location.assign("/login");`,
  "sign-out navigation",
);
await writeFile("web/chat.js", chat);

let html = await load("web/chat.html");
html = one(
  html,
  `    <script type="module" src="/chat.js"></script>
    <script type="module" src="/product-info.js"></script>`,
  `    <script type="module" src="/chat.js"></script>
    <script type="module" src="/workspace.js"></script>
    <script type="module" src="/product-info.js"></script>`,
  "workspace UI module",
);
await writeFile("web/chat.html", html);
