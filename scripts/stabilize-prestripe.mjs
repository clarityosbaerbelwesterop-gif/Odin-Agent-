import { readFile, writeFile } from "node:fs/promises";

async function read(path) {
  return readFile(path, "utf8");
}
async function write(path, content) {
  await writeFile(path, content);
}
function once(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing anchor ${label}`);
  return text.replace(from, to);
}
function all(text, from, to) {
  return text.split(from).join(to);
}

// Runtime access: keep the Stripe entitlement model intact, but expose the full product while Stripe is absent.
{
  const path = "src/chat/product.ts";
  let text = await read(path);
  const anchor = `export function effectivePlan(account: Pick<ProductAccount, "plan" | "subscriptionStatus">): Plan {\n  return account.plan !== "free" && PAID_STATUSES.has(account.subscriptionStatus)\n    ? account.plan\n    : "free";\n}\n`;
  const replacement = `${anchor}\n/** Temporary product-wide test lane. It closes automatically once Stripe is configured. */\nexport function preStripeTestMode(env: NodeJS.ProcessEnv = process.env): boolean {\n  return env.ODIN_PRESTRIPE_TEST_MODE === "true" || !env.STRIPE_SECRET_KEY;\n}\n\nexport function runtimePlan(\n  account: Pick<ProductAccount, "plan" | "subscriptionStatus">,\n  env: NodeJS.ProcessEnv = process.env,\n): Plan {\n  return preStripeTestMode(env) ? "ultra" : effectivePlan(account);\n}\n`;
  text = once(text, anchor, replacement, "runtimePlan");
  await write(path, text);
}

// Auth: Neon production is configured not to require verification. Odin must not add a conflicting gate.
{
  const path = "src/chat/neon-auth.ts";
  let text = await read(path);
  text = all(
    text,
    `      if (!identity.emailVerified)\n        throw new ChatError(\n          "EMAIL_UNVERIFIED",\n          "Verify your email before opening the workspace.",\n          403,\n        );\n      return identity;`,
    `      return identity;`,
  );
  text = all(
    text,
    `    if (!identity.emailVerified)\n      throw new ChatError(\n        "EMAIL_UNVERIFIED",\n        "Verify your email before opening the workspace.",\n        403,\n      );\n    return identity;`,
    `    return identity;`,
  );
  await write(path, text);
}

// Repository reads are useful context in every mode. Writes remain coding/ultra only.
{
  const path = "src/chat/modes.ts";
  let text = await read(path);
  text = once(
    text,
    `  if (name.startsWith("research.")) return mode === "research" || mode === "ultra";\n  if (name.startsWith("repo.")) return mode === "coding" || mode === "ultra";`,
    `  if (name.startsWith("research.")) return mode === "research" || mode === "ultra";\n  if (name === "repo.search" || name === "repo.read") return true;\n  if (name === "repo.patch" || name === "repo.quality")\n    return mode === "coding" || mode === "ultra";`,
    "repository read tools",
  );
  await write(path, text);
}

// Screenshot/image attachment transport.
{
  const path = "src/chat/types.ts";
  let text = await read(path);
  text = once(
    text,
    `  readonly objective: string;\n  readonly createdAt: string;`,
    `  readonly objective: string;\n  readonly attachments?: readonly {\n    readonly type: "image_url";\n    readonly url: string;\n    readonly mediaType: string;\n  }[];\n  readonly createdAt: string;`,
    "turn attachments",
  );
  await write(path, text);
}
{
  const path = "src/chat/engine.ts";
  let text = await read(path);
  text = once(
    text,
    `    requestId: string;\n  }): Promise<ChatTurnView> {`,
    `    requestId: string;\n    attachments?: readonly { type: "image_url"; url: string; mediaType: string }[];\n  }): Promise<ChatTurnView> {`,
    "submit attachments type",
  );
  text = once(
    text,
    `    const modelId = identifier(input.modelId);\n    if (!this.#models.has(modelId))\n      throw new ChatError(\n        "MODEL_UNAVAILABLE",\n        "No provider is configured for the selected model.",\n        409,\n      );\n    const key = identifier(input.requestId);\n    const requestHash = hashText(JSON.stringify({ text, mode, modelId }));`,
    `    const modelId = identifier(input.modelId);\n    const selectedModel = this.#models.get(modelId);\n    if (!selectedModel)\n      throw new ChatError(\n        "MODEL_UNAVAILABLE",\n        "No provider is configured for the selected model.",\n        409,\n      );\n    const attachments = [...(input.attachments ?? [])];\n    if (attachments.length > 2)\n      throw new ChatError("ATTACHMENT_LIMIT", "Attach at most two screenshots per mission.", 413);\n    for (const attachment of attachments) {\n      if (\n        !["image/png", "image/jpeg", "image/webp"].includes(attachment.mediaType) ||\n        !attachment.url.startsWith(\`data:\${attachment.mediaType};base64,\`) ||\n        attachment.url.length > 950_000\n      )\n        throw new ChatError(\n          "INVALID_ATTACHMENT",\n          "Screenshots must be PNG, JPEG or WebP and stay below the upload limit.",\n          400,\n        );\n    }\n    if (attachments.length && !selectedModel.provider.capabilities(selectedModel.model).capabilities.imageInput)\n      throw new ChatError(\n        "IMAGE_UNSUPPORTED",\n        "The selected model does not support screenshot input. Choose a vision-capable model.",\n        409,\n      );\n    const key = identifier(input.requestId);\n    const requestHash = hashText(JSON.stringify({ text, mode, modelId, attachments }));`,
    "attachment validation",
  );
  text = once(
    text,
    `        objective: text,\n        createdAt: new Date().toISOString(),`,
    `        objective: text,\n        ...(attachments.length ? { attachments } : {}),\n        createdAt: new Date().toISOString(),`,
    "turn attachment storage",
  );
  text = once(
    text,
    `      await this.store.emit(created, "message.user", { text, mode });`,
    `      await this.store.emit(created, "message.user", { text, mode, attachmentCount: attachments.length });`,
    "attachment event",
  );
  await write(path, text);
}
{
  const path = "src/chat/agent.ts";
  let text = await read(path);
  text = once(
    text,
    `      { role: "user", content: [{ type: "text", text: turn.objective }] },`,
    `      {\n        role: "user",\n        content: [\n          { type: "text", text: turn.objective },\n          ...(turn.attachments ?? []),\n        ],\n      },`,
    "agent image seed",
  );
  await write(path, text);
}
{
  const path = "src/chat/neon-store.ts";
  let text = await read(path);
  text = once(text, `    const [data, hash] = encode(turn, 40000);`, `    const [data, hash] = encode(turn, 2_000_000);`, "turn storage size");
  await write(path, text);
}

// Bot worker follows runtimePlan during the explicit pre-Stripe test window.
{
  const path = "src/bot/executor.ts";
  let text = await read(path);
  text = once(text, `  effectivePlan,\n`, `  runtimePlan,\n`, "bot runtime plan import");
  text = all(text, `effectivePlan(account)`, `runtimePlan(account)`);
  await write(path, text);
}

// Hosted API: full test access, cleaner GitHub callback, connectors, image payloads.
{
  const path = "src/chat/hosted.ts";
  let text = await read(path);
  text = once(text, `  effectivePlan,\n`, `  preStripeTestMode,\n  runtimePlan,\n`, "hosted runtime plan import");
  text = all(text, `effectivePlan(`, `runtimePlan(`);
  text = once(text, `        emailVerificationRequired: true,`, `        emailVerificationRequired: false,`, "auth verification config");
  text = all(
    text,
    `      if (!identity.emailVerified)\n        throw new ChatError(\n          "EMAIL_UNVERIFIED",\n          "Verify your email before opening the workspace.",\n          403,\n        );\n      res.setHeader("Set-Cookie", auth.oauthJwtCookie(body.token));`,
    `      res.setHeader("Set-Cookie", auth.oauthJwtCookie(body.token));`,
  );
  text = once(
    text,
    `      send(res, 200, { ok: true, requiresVerification: operation === "signup" });`,
    `      send(res, 200, { ok: true, requiresVerification: false });`,
    "auth response verification",
  );
  text = once(
    text,
    `        account: { ...account, effectivePlan: runtimePlan(account) },`,
    `        account: { ...account, effectivePlan: runtimePlan(account) },\n        testing: { preStripeAccess: preStripeTestMode() },`,
    "config testing flag",
  );
  text = once(
    text,
    `        team: botSpecialists(),\n        limits,\n        runtime: {`,
    `        team: botSpecialists(),\n        limits,\n        testing: { preStripeAccess: preStripeTestMode() },\n        connectors: {\n          github: {\n            connected: githubConnection.connected,\n            login: githubConnection.connected ? githubConnection.login : null,\n            repository: githubConnection.connected ? githubConnection.repository : null,\n            branch: githubConnection.connected ? githubConnection.defaultBranch : null,\n            ready: githubWorkspaceReady,\n          },\n          research: { connected: true, label: "Wikipedia / Wikimedia" },\n          models: availableModels.map((model) => ({\n            id: model.id,\n            label: model.label,\n            provider: model.provider.id,\n            imageInput: model.provider.capabilities(model.model).capabilities.imageInput,\n          })),\n          providers: await product.credentials(),\n        },\n        runtime: {`,
    "bot connectors",
  );
  const oldCallback = `    if (url.pathname === "/api/github/callback" && method === "GET") {\n      await product.consumeOAuthState(url.searchParams.get("state") ?? "");\n      const code = url.searchParams.get("code");\n      const client = process.env.GITHUB_REPO_OAUTH_CLIENT_ID;\n      const secret = process.env.GITHUB_REPO_OAUTH_CLIENT_SECRET;\n      if (!code || !client || !secret)\n        throw new ChatError("GITHUB_OAUTH", "GitHub authorization failed.", 400);\n      const response = await fetch("https://github.com/login/oauth/access_token", {\n        method: "POST",\n        headers: { Accept: "application/json", "Content-Type": "application/json" },\n        body: JSON.stringify({\n          client_id: client,\n          client_secret: secret,\n          code,\n          redirect_uri: \`${origin}/api/github/callback\`,\n        }),\n      });\n      const token = (await response.json()) as { access_token?: string };\n      if (!response.ok || !token.access_token)\n        throw new ChatError("GITHUB_OAUTH", "GitHub authorization failed.", 502);\n      const user = await github(token.access_token, "/user");\n      if (Array.isArray(user) || typeof user.login !== "string")\n        throw new ChatError("GITHUB_UPSTREAM", "GitHub user response was invalid.", 502);\n      await product.saveGithub(token.access_token, user.login);\n      res.statusCode = 303;\n      res.setHeader("Location", "/app?settings=github");\n      res.end();\n      return;\n    }`;
  const newCallback = `    if (url.pathname === "/api/github/callback" && method === "GET") {\n      try {\n        await product.consumeOAuthState(url.searchParams.get("state") ?? "");\n        const code = url.searchParams.get("code");\n        const client = process.env.GITHUB_REPO_OAUTH_CLIENT_ID;\n        const secret = process.env.GITHUB_REPO_OAUTH_CLIENT_SECRET;\n        if (!code || !client || !secret)\n          throw new ChatError("GITHUB_OAUTH", "GitHub authorization failed.", 400);\n        const response = await fetch("https://github.com/login/oauth/access_token", {\n          method: "POST",\n          headers: { Accept: "application/json", "Content-Type": "application/json" },\n          body: JSON.stringify({\n            client_id: client,\n            client_secret: secret,\n            code,\n            redirect_uri: \`${origin}/api/github/callback\`,\n          }),\n          redirect: "error",\n          signal: AbortSignal.timeout(10_000),\n        });\n        const token = (await response.json()) as { access_token?: string; error?: string };\n        if (!response.ok || !token.access_token)\n          throw new ChatError("GITHUB_OAUTH", "GitHub authorization failed.", 502);\n        const user = await github(token.access_token, "/user");\n        if (Array.isArray(user) || typeof user.login !== "string")\n          throw new ChatError("GITHUB_UPSTREAM", "GitHub user response was invalid.", 502);\n        await product.saveGithub(token.access_token, user.login);\n        res.statusCode = 303;\n        res.setHeader("Location", "/app?workspace=connected");\n        res.end();\n      } catch (error) {\n        const code = error instanceof ChatError ? error.code : "GITHUB_OAUTH";\n        res.statusCode = 303;\n        res.setHeader("Location", \`/app?workspace=error&code=\${encodeURIComponent(code)}\`);\n        res.end();\n      }\n      return;\n    }`;
  text = once(text, oldCallback, newCallback, "github callback UX");
  text = once(
    text,
    `          const body = object(await jsonBody(req), ["text", "mode", "modelId", "requestId"]);`,
    `          const body = object(await jsonBody(req, 2_100_000), [\n            "text",\n            "mode",\n            "modelId",\n            "requestId",\n            "attachments",\n          ]);`,
    "large turn body",
  );
  text = once(
    text,
    `              requestId: identifier(body.requestId),\n            }),`,
    `              requestId: identifier(body.requestId),\n              attachments: Array.isArray(body.attachments)\n                ? body.attachments.map((item) => {\n                    if (!item || typeof item !== "object" || Array.isArray(item))\n                      throw new ChatError("INVALID_ATTACHMENT", "Invalid screenshot attachment.");\n                    const value = item as Record<string, unknown>;\n                    return {\n                      type: "image_url" as const,\n                      url: String(value.url ?? ""),\n                      mediaType: String(value.mediaType ?? ""),\n                    };\n                  })\n                : [],\n            }),`,
    "submit attachments",
  );
  text = once(
    text,
    `async function jsonBody(req: IncomingMessage): Promise<unknown> {`,
    `async function jsonBody(req: IncomingMessage, maxBytes = 64_000): Promise<unknown> {`,
    "jsonBody signature",
  );
  text = once(text, `    if (size > 64000) throw new ChatError("BODY_LIMIT", "Request is too large.", 413);`, `    if (size > maxBytes) throw new ChatError("BODY_LIMIT", "Request is too large.", 413);`, "json body limit");
  await write(path, text);
}

// Login: social and email sessions are first-class; OTP remains optional recovery rather than a blocking gate.
{
  const path = "web/login.html";
  let text = await read(path);
  text = once(text, `<script type="module" src="/login.js"></script>\n    <script type="module" src="/login-github-recovery.js"></script>`, `<script type="module" src="/login.js"></script>`, "remove stale recovery script");
  text = once(
    text,
    `Mit der Nutzung von Odin gelten die <a href="/eula.html">Nutzungsbedingungen</a> und die <a href="/privacy.html">Datenschutzerklärung</a>.`,
    `Mit der Nutzung von Odin gelten die <a href="/eula.html">AGB & Nutzungsbedingungen</a>, die <a href="/privacy.html">Datenschutzerklärung</a>, die <a href="/cookies.html">Cookie-Informationen</a> und die <a href="/ai-act.html">KI-Transparenz</a>.`,
    "login legal links",
  );
  await write(path, text);
}
{
  const path = "web/login.js";
  let text = await read(path);
  text = once(
    text,
    `    if (mode === "signup") {\n      $("auth-password").value = "";\n      await clearIncompleteSession();\n      applyMode("verify");\n      try {\n        await request("/api/auth/sendCode", { email });\n        status("Konto erstellt. Der Bestätigungscode wurde per E-Mail gesendet.", "success");\n      } catch {\n        status(\n          "Konto erstellt. Der Code konnte nicht automatisch gesendet werden. Nutze „Code senden“.",\n          "error",\n        );\n      }\n    } else if (mode === "forgot") {`,
    `    if (mode === "signup") {\n      $("auth-password").value = "";\n      try {\n        await request("/api/config");\n        status("Konto erstellt. Workspace wird geöffnet …", "success");\n        window.location.replace(safeReturnTo());\n        return;\n      } catch {\n        applyMode("login");\n        status("Konto erstellt. Melde dich jetzt an.", "success");\n      }\n    } else if (mode === "forgot") {`,
    "signup no forced OTP",
  );
  await write(path, text);
}

// Workspace UX: never leave users on a black JSON callback, retry session propagation, and reopen picker after OAuth.
{
  const path = "web/workspace.js";
  let text = await read(path);
  text = once(
    text,
    `async function refreshConfig() {\n  config = await request("/api/config");`,
    `async function refreshConfig(retries = 0) {\n  try {\n    config = await request("/api/config");\n  } catch (error) {\n    if (retries < 3 && [401, 409, 502, 503].includes(error.status)) {\n      await new Promise((resolve) => setTimeout(resolve, 350 * (retries + 1)));\n      return refreshConfig(retries + 1);\n    }\n    throw error;\n  }`,
    "workspace config retry",
  );
  text = once(
    text,
    `refreshConfig().catch(() => {\n  currentValue.textContent = "Workspace";\n});`,
    `async function bootstrapWorkspace() {\n  try {\n    await refreshConfig();\n    const params = new URLSearchParams(window.location.search);\n    if (params.get("workspace") === "connected") {\n      await openPicker();\n      window.history.replaceState({}, "", "/app");\n    } else if (params.get("workspace") === "error") {\n      await openPicker();\n      showError(new Error(\`GitHub-Verbindung fehlgeschlagen (\${params.get("code") ?? "GITHUB_OAUTH"}). Bitte erneut versuchen.\`));\n      window.history.replaceState({}, "", "/app");\n    } else if (params.get("workspace") === "1") {\n      await openPicker();\n    }\n  } catch {\n    currentValue.textContent = "Workspace";\n  }\n}\nvoid bootstrapWorkspace();`,
    "workspace bootstrap",
  );
  await write(path, text);
}

// Chat UX: no plan labels during test, repository state refresh, screenshots, and AI transparency.
{
  const path = "web/chat.html";
  let text = await read(path);
  text = once(text, `<a href="/bot" class="nav-item">Odin Bot <span>PRO</span></a>`, `<a href="/bot" class="nav-item">Odin Bot <span>TEST</span></a>`, "bot nav test badge");
  text = once(
    text,
    `<div class="composer-bottom">\n                  <div class="selectors">`,
    `<div id="attachment-preview" class="attachment-preview" hidden></div>\n                <div class="composer-bottom">\n                  <div class="selectors">\n                    <input id="screenshot-input" type="file" accept="image/png,image/jpeg,image/webp" hidden />\n                    <button id="screenshot-button" type="button" class="attachment-button" aria-label="Screenshot anhängen">Bild +</button>`,
    "screenshot input",
  );
  text = once(
    text,
    `<div class="composer-meta"><span id="mode-description">Wähle, wie Odin die Aufgabe bearbeitet.</span><span>Enter sendet · Umschalt + Enter fügt eine neue Zeile ein</span></div>`,
    `<div class="composer-meta"><span id="mode-description">Wähle, wie Odin die Aufgabe bearbeitet.</span><span>Enter sendet · Umschalt + Enter fügt eine neue Zeile ein</span></div>\n              <p class="ai-disclosure">KI-Hinweis: Du interagierst mit einem KI-System. Modell, Provider, Tool-Nutzung und Prüfstatus werden im Workspace sichtbar gemacht.</p>`,
    "AI disclosure",
  );
  await write(path, text);
}
{
  const path = "web/chat.js";
  let text = await read(path);
  text = once(text, `let pendingRequest = null;`, `let pendingRequest = null;\nlet screenshotAttachment = null;`, "screenshot state");
  text = once(
    text,
    `  for (const model of config.models) {\n    const tier = model.plan ? model.plan.toUpperCase() : "MODEL";\n    const option = element("option", \`${model.label} · \${tier}\`);`,
    `  for (const model of config.models) {\n    const tier = model.plan ? model.plan.toUpperCase() : "MODEL";\n    const option = element(\n      "option",\n      config.testing?.preStripeAccess ? model.label : \`${model.label} · \${tier}\`,\n    );`,
    "hide test plan labels",
  );
  text = once(
    text,
    `      const identity = JSON.stringify({\n        conversationId,\n        text,\n        mode: $("mode").value,\n        modelId: $("model").value,\n      });`,
    `      const selectedModel = config.models.find((model) => model.id === $("model").value);\n      if (screenshotAttachment && !selectedModel?.profile?.capabilities?.imageInput)\n        throw new Error("Das ausgewählte Modell unterstützt keine Bilder. Wähle ein Vision-Modell.");\n      const identity = JSON.stringify({\n        conversationId,\n        text,\n        mode: $("mode").value,\n        modelId: $("model").value,\n        attachment: screenshotAttachment?.url ?? null,\n      });`,
    "attachment identity",
  );
  text = once(
    text,
    `        requestId: pendingRequest.requestId,\n      });\n      pendingRequest = null;`,
    `        requestId: pendingRequest.requestId,\n        attachments: screenshotAttachment ? [screenshotAttachment] : [],\n      });\n      pendingRequest = null;\n      screenshotAttachment = null;\n      renderScreenshotPreview();`,
    "send attachment",
  );
  const insertBefore = `$("composer").onsubmit = async (event) => {`;
  const attachmentFunctions = `function renderScreenshotPreview() {\n  const target = $("attachment-preview");\n  target.replaceChildren();\n  target.hidden = !screenshotAttachment;\n  if (!screenshotAttachment) return;\n  const img = document.createElement("img");\n  img.src = screenshotAttachment.url;\n  img.alt = "Angehängter Screenshot";\n  const remove = element("button", "Entfernen");\n  remove.type = "button";\n  remove.onclick = () => {\n    screenshotAttachment = null;\n    $("screenshot-input").value = "";\n    renderScreenshotPreview();\n  };\n  target.append(img, remove);\n}\nasync function compressScreenshot(file) {\n  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))\n    throw new Error("Nur PNG, JPEG oder WebP werden unterstützt.");\n  const bitmap = await createImageBitmap(file);\n  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));\n  const canvas = document.createElement("canvas");\n  canvas.width = Math.max(1, Math.round(bitmap.width * scale));\n  canvas.height = Math.max(1, Math.round(bitmap.height * scale));\n  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);\n  bitmap.close();\n  let quality = 0.86;\n  let url = canvas.toDataURL("image/jpeg", quality);\n  while (url.length > 900_000 && quality > 0.5) {\n    quality -= 0.08;\n    url = canvas.toDataURL("image/jpeg", quality);\n  }\n  if (url.length > 950_000) throw new Error("Screenshot ist nach Komprimierung noch zu groß.");\n  return { type: "image_url", url, mediaType: "image/jpeg" };\n}\n$("screenshot-button").onclick = () => $("screenshot-input").click();\n$("screenshot-input").onchange = async () => {\n  const file = $("screenshot-input").files?.[0];\n  if (!file) return;\n  try {\n    screenshotAttachment = await compressScreenshot(file);\n    renderScreenshotPreview();\n  } catch (error) {\n    errorBanner(error);\n    $("screenshot-input").value = "";\n  }\n};\nwindow.addEventListener("odin:workspace-changed", async () => {\n  try {\n    config = await api("/api/config");\n    $("workspace-status").textContent = config.workspace?.writable\n      ? "Workspace verbunden"\n      : "Workspace nicht verbunden";\n  } catch (error) {\n    errorBanner(error);\n  }\n});\n\n`;
  text = once(text, insertBefore, attachmentFunctions + insertBefore, "attachment functions");
  await write(path, text);
}
{
  const path = "web/chat.css";
  let text = await read(path);
  text += `\n.attachment-button{border:1px solid #343944;background:transparent;color:#cbd2df;border-radius:10px;padding:7px 10px;cursor:pointer}.attachment-preview{display:flex;align-items:center;gap:10px;padding:8px 12px}.attachment-preview img{width:72px;height:54px;object-fit:cover;border-radius:9px;border:1px solid #343944}.attachment-preview button{background:transparent;color:#aab2c0;border:0;text-decoration:underline}.ai-disclosure{margin:4px 0 0;color:#777f8d;font-size:11px;line-height:1.45}\n`;
  await write(path, text);
}

// Bot gets visible connectors plus explicit mode/model choice during the full-access test.
{
  const path = "web/bot.html";
  let text = await read(path);
  text = once(text, `<div class="top-actions"><span id="plan-pill">PRO</span><a href="/app">Missions</a></div>`, `<div class="top-actions"><span id="plan-pill">TEST ACCESS</span><a href="/app">Missions</a></div>`, "bot test pill");
  text = once(
    text,
    `<textarea id="goal" maxlength="16000" rows="2" placeholder="What should I take care of?" required></textarea>\n            <button type="submit" aria-label="Give task to Odin Bot">↑</button>`,
    `<textarea id="goal" maxlength="16000" rows="2" placeholder="What should I take care of?" required></textarea>\n            <div class="bot-selectors"><select id="bot-mode" aria-label="Bot mode"><option value="thinking">Thinking</option><option value="research">Research</option><option value="coding">Coding</option><option value="ultra">Ultra</option><option value="chat">Chat</option></select><select id="bot-model" aria-label="Bot model"><option value="">Auto model</option></select></div>\n            <button type="submit" aria-label="Give task to Odin Bot">↑</button>`,
    "bot selectors",
  );
  text = once(
    text,
    `<section class="stream" aria-label="Odin Bot activity">`,
    `<section class="stream" aria-label="Connected tools"><div class="section-head"><h2>Connectors</h2><a href="/app?workspace=1">Manage</a></div><div id="connectors" class="connector-grid"></div><p class="bot-ai-note">KI-Hinweis: Odin Bot ist ein KI-System. Hintergrundaufgaben, Modellwahl, Werkzeuge und Freigaben bleiben im Missionsprotokoll nachvollziehbar.</p></section>\n\n        <section class="stream" aria-label="Odin Bot activity">`,
    "bot connectors section",
  );
  await write(path, text);
}
{
  const path = "web/bot.js";
  let text = await read(path);
  text = once(
    text,
    `  $("plan-pill").textContent = String(snapshot.limits?.plan ?? "pro").toUpperCase();`,
    `  $("plan-pill").textContent = snapshot.testing?.preStripeAccess\n    ? "TEST ACCESS"\n    : String(snapshot.limits?.plan ?? "pro").toUpperCase();\n  renderConnectors();`,
    "bot test badge",
  );
  const renderAnchor = `async function load() {`;
  const renderConnectors = `function renderConnectors() {\n  const target = $("connectors");\n  if (!target || !snapshot) return;\n  target.replaceChildren();\n  const github = snapshot.connectors?.github;\n  const cards = [\n    ["GitHub", github?.ready ? \`${github.repository} · ${github.branch}\` : github?.connected ? "Account verbunden · Repository auswählen" : "Nicht verbunden"],\n    ["Research", snapshot.connectors?.research?.connected ? snapshot.connectors.research.label : "Nicht verbunden"],\n    ["Modelle", \`${snapshot.connectors?.models?.length ?? 0} serverseitig verfügbar\`],\n  ];\n  for (const [name, detail] of cards) {\n    const card = document.createElement("div");\n    card.className = "connector-card";\n    const strong = document.createElement("strong");\n    const small = document.createElement("small");\n    strong.textContent = name;\n    small.textContent = detail;\n    card.append(strong, small);\n    target.append(card);\n  }\n  const model = $("bot-model");\n  const current = model.value;\n  model.replaceChildren(new Option("Auto model", ""));\n  for (const item of snapshot.connectors?.models ?? []) model.append(new Option(\`${item.label} · ${item.provider}\`, item.id));\n  if ([...model.options].some((option) => option.value === current)) model.value = current;\n}\n\n`;
  text = once(text, renderAnchor, renderConnectors + renderAnchor, "bot connector render");
  text = once(
    text,
    `      body: JSON.stringify({ goal, idempotencyKey: crypto.randomUUID() }),`,
    `      body: JSON.stringify({\n        goal,\n        mode: $("bot-mode").value,\n        modelId: $("bot-model").value || undefined,\n        idempotencyKey: crypto.randomUUID(),\n      }),`,
    "bot mode/model request",
  );
  await write(path, text);
}
{
  const path = "web/bot.css";
  let text = await read(path);
  text += `\n.bot-selectors{display:flex;gap:8px;grid-column:1/-1}.bot-selectors select{background:#111318;border:1px solid #303640;color:#dce2eb;border-radius:10px;padding:8px}.connector-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.connector-card{border:1px solid #292e37;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:5px}.connector-card small,.bot-ai-note{color:#7f8794}.bot-ai-note{font-size:11px;line-height:1.5}\n`;
  await write(path, text);
}

// Legal surfaces. Operator identity remains an explicit launch gate rather than being invented.
const footer = `<footer><a href="/eula.html">AGB</a><a href="/privacy.html">Datenschutz</a><a href="/cookies.html">Cookies</a><a href="/ai-act.html">EU AI Act</a><a href="/gdpr.html">DSGVO-Readiness</a><a href="/imprint.html">Impressum</a><a href="/">Startseite</a></footer>`;
await write("web/eula.html", `<!doctype html><html lang="de"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex"/><title>Odin — AGB & Nutzungsbedingungen</title><link rel="stylesheet" href="/legal.css"/></head><body><header><a class="brand" href="/">odin↗</a><a href="/app">Workspace öffnen</a></header><main><span class="status">TESTBETRIEB · 12.09.2026</span><h1>AGB & Nutzungsbedingungen</h1><p class="notice"><strong>Launch-Gate:</strong> Betreibername/Rechtsform, ladungsfähige Anschrift, Supportkontakt und ggf. Register-/USt.-Angaben müssen vor öffentlichem kommerziellem Launch ergänzt und rechtlich geprüft werden.</p><h2>1. Gegenstand</h2><p>Odin ist ein KI-gestützter Agent-Workspace für Chat, Analyse, Recherche, Coding, Repository-Arbeit und kontrollierte Hintergrundaufgaben. Im aktuellen Testbetrieb sind Funktionen freigeschaltet, damit das Produkt vor Aktivierung kostenpflichtiger Abos geprüft werden kann.</p><h2>2. Konto und Berechtigungen</h2><p>Nutzer müssen ihre Zugangsdaten schützen und dürfen nur Konten, Repositories, Dateien und externe Dienste verbinden, für die sie die erforderliche Berechtigung besitzen. OAuth-Freigaben können jederzeit beim jeweiligen Anbieter widerrufen werden.</p><h2>3. Agentische Aktionen</h2><p>Odin kann je nach Modus lesen, planen, recherchieren, Dateien ändern, Tests ausführen, Branches/Pull Requests vorbereiten und zeitgesteuerte Aufgaben bearbeiten. Schreibende oder externe Aktionen bleiben an die im Produkt angezeigten Berechtigungen, Freigaben und Sicherheitsgrenzen gebunden. Nutzer müssen produktionskritische Änderungen vor Übernahme angemessen prüfen.</p><h2>4. KI-Ausgaben</h2><p>KI-Ausgaben können falsch, unvollständig oder ungeeignet sein. Odin zeigt Modell-, Tool- und Prüfstatus soweit technisch vorgesehen an; dies ist keine Garantie für Fehlerfreiheit. Odin ist nicht für ausschließlich automatisierte Entscheidungen mit rechtlicher oder ähnlich erheblicher Wirkung vorgesehen.</p><h2>5. Inhalte und Rechte</h2><p>Rechte an eigenen Inhalten verbleiben grundsätzlich beim jeweiligen Rechteinhaber. Der Nutzer räumt nur die zur Bereitstellung des angeforderten Dienstes technisch erforderlichen Nutzungsrechte ein. Es dürfen keine Inhalte oder Repositories verarbeitet werden, deren Nutzung Rechte Dritter verletzt.</p><h2>6. Drittanbieter</h2><p>Für Hosting, Authentifizierung, Datenbank, GitHub-Integration, Modellbereitstellung und Recherche werden je nach Funktion externe Dienste eingesetzt. Dazu können insbesondere Vercel, Neon, GitHub, NVIDIA, UnoRouter und Wikimedia gehören. Für diese Dienste können ergänzende Bedingungen der jeweiligen Anbieter gelten.</p><h2>7. Zulässige Nutzung</h2><p>Untersagt sind insbesondere rechtswidrige Nutzung, unbefugter Zugriff, Credential-Diebstahl, Schadsoftware, absichtliche Überlastung, Umgehung technischer Schutzmaßnahmen und die Nutzung von Odin zur Verletzung von Rechten Dritter.</p><h2>8. Testbetrieb und spätere Abos</h2><p>Bis zur ausdrücklichen Aktivierung von Stripe befindet sich Odin im Pre-Stripe-Testbetrieb. Angezeigte frühere Tarifstufen begründen derzeit keinen kostenpflichtigen Vertrag. Preise, Kontingente und Abobedingungen werden vor einem Paid Launch gesondert veröffentlicht und in Checkout/Bestellprozess bestätigt.</p><h2>9. Verfügbarkeit und Änderungen</h2><p>Im Testbetrieb können Funktionen, Modelle, Limits und Integrationen geändert oder vorübergehend deaktiviert werden. Sicherheitsrelevante Funktionen können bei Missbrauch oder konkretem Risiko eingeschränkt werden.</p><h2>10. Haftung</h2><p>Unbeschränkt bleibt die Haftung bei Vorsatz und grober Fahrlässigkeit, Verletzung von Leben, Körper oder Gesundheit, Produkthaftung sowie sonstiger zwingender gesetzlicher Haftung. Bei leicht fahrlässiger Verletzung wesentlicher Vertragspflichten ist die Haftung, soweit gesetzlich zulässig, auf den typischen vorhersehbaren Schaden begrenzt. Zwingende Verbraucherrechte bleiben unberührt.</p><h2>11. Beendigung, Export und Löschung</h2><p>Technische Export- und Löschfunktionen werden im Produkt bereitgestellt. Gesetzliche Aufbewahrungspflichten und notwendige Sicherheitsnachweise können einer sofortigen vollständigen Löschung einzelner Daten entgegenstehen.</p><h2>12. Recht</h2><p>Es gilt deutsches Recht, soweit rechtlich zulässig. Zwingende Verbraucherschutzvorschriften des gewöhnlichen Aufenthaltsorts bleiben unberührt. Gesetzliche Gerichtsstände gelten.</p><p>Dieser technische Entwurf ersetzt keine individuelle Rechtsberatung.</p></main>${footer}</body></html>`);
await write("web/privacy.html", `<!doctype html><html lang="de"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex"/><title>Odin — Datenschutzerklärung</title><link rel="stylesheet" href="/legal.css"/></head><body><header><a class="brand" href="/">odin↗</a><a href="/app">Workspace öffnen</a></header><main><span class="status">TESTBETRIEB · 12.09.2026</span><h1>Datenschutzerklärung</h1><p class="notice"><strong>Launch-Gate:</strong> Verantwortlicher, ladungsfähige Anschrift und Datenschutz-/Supportkontakt müssen vor öffentlichem Launch ergänzt werden. Auftragsverarbeitungs-, Subprozessor- und Drittlandtransferprüfungen sind vor Paid Launch final zu dokumentieren.</p><h2>Verantwortlicher</h2><p><strong>[BETREIBERNAME / RECHTSFORM]</strong><br/>[LADUNGSFÄHIGE ANSCHRIFT]<br/>[DATENSCHUTZ-/SUPPORT-E-MAIL]</p><h2>Welche Daten verarbeitet werden</h2><p>Je nach Nutzung verarbeitet Odin Konto- und Sitzungsdaten, E-Mail-Adresse, Prompts und Antworten, Screenshots/Bildanhänge, Missions- und Automationsstatus, ausgewählte GitHub-Repositories/Branches, Workspace-Dateien und Änderungen, Rechercheanfragen/Quellen sowie begrenzte Sicherheits-, Fehler- und Nutzungsmetadaten. Provider-Zugangsdaten und GitHub-Tokens werden serverseitig gespeichert und nicht an den Browser ausgegeben.</p><h2>Zwecke und Rechtsgrundlagen</h2><p>Die angeforderte Dienstbereitstellung erfolgt grundsätzlich zur Vertragsdurchführung bzw. vorvertraglichen Nutzung nach Art. 6 Abs. 1 lit. b DSGVO. Sicherheits- und Missbrauchsabwehr kann auf Art. 6 Abs. 1 lit. f DSGVO gestützt werden; gesetzliche Pflichten auf Art. 6 Abs. 1 lit. c DSGVO. Soweit künftig Einwilligung erforderlich wird, erfolgt Verarbeitung erst nach entsprechender Einwilligung.</p><h2>Empfänger und Dienste</h2><ul><li><strong>Neon:</strong> Postgres und Authentifizierung.</li><li><strong>Vercel:</strong> Hosting und Serverless-Ausführung.</li><li><strong>GitHub:</strong> Login oder separat autorisierter Repository-Zugriff.</li><li><strong>NVIDIA / UnoRouter:</strong> Modellanfragen, sofern das jeweilige Modell genutzt wird.</li><li><strong>Wikimedia/Wikipedia:</strong> Recherchequellen, wenn Research verwendet wird.</li></ul><h2>Drittlandtransfers</h2><p>Soweit Empfänger Daten außerhalb des EWR verarbeiten, werden die Voraussetzungen der Art. 44 ff. DSGVO einschließlich geeigneter Garantien und Transferprüfung vor produktivem öffentlichen Launch dokumentiert.</p><h2>Speicherdauer</h2><p>Daten werden nur so lange gespeichert, wie dies für Konto, Missionshistorie, Workspace-Funktion, Sicherheit, Fehleranalyse oder gesetzliche Pflichten erforderlich ist. Eine verbindliche produktive Fristenmatrix für Kontodaten, Missionsdaten, Logs und Backups bleibt vor Paid Launch zu finalisieren.</p><h2>GitHub und Repositories</h2><p>GitHub-Login und Repository-Autorisierung sind getrennte OAuth-Freigaben. Odin greift nur im Umfang der erteilten Berechtigung und der im Workspace gewählten Repository-/Branch-Konfiguration zu. Repository-Zugriff kann in Odin und bei GitHub widerrufen werden.</p><h2>KI-Verarbeitung und Bilder</h2><p>Prompts, ausgewählte Repository-Inhalte und angehängte Screenshots können zur Bearbeitung an den jeweils ausgewählten Modellanbieter übertragen werden. Bildanhänge werden nur an Modelle gesendet, die im Backend als bildfähig ausgewiesen sind.</p><h2>Cookies und lokale Speicherung</h2><p>Odin nutzt derzeit nur technisch notwendige Authentifizierungs-/Sitzungsmechanismen und sicherheitsbezogene Browser-Speicherung. Einzelheiten stehen in den <a href="/cookies.html">Cookie-Informationen</a>. Marketing- oder Profiling-Tracking ist im aktuellen Pfad nicht vorgesehen.</p><h2>Betroffenenrechte</h2><p>Je nach Voraussetzungen bestehen insbesondere Rechte nach Art. 15–21 DSGVO auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch sowie ein Beschwerderecht bei einer Datenschutzaufsichtsbehörde.</p><h2>Automatisierte Entscheidungen</h2><p>Odin ist nicht für ausschließlich automatisierte Entscheidungen im Sinne des Art. 22 DSGVO mit rechtlicher oder ähnlich erheblicher Wirkung vorgesehen. Agentische Vorschläge und Änderungen sollen durch technische Grenzen, Prüfpfade und bei kritischen Vorgängen menschliche Freigaben kontrolliert werden.</p><p>Rechtsquellen: <a href="https://eur-lex.europa.eu/eli/reg/2016/679/oj">DSGVO</a>, <a href="https://www.gesetze-im-internet.de/ttdsg/__25.html">§ 25 TDDDG</a>, <a href="https://www.gesetze-im-internet.de/ddg/__5.html">§ 5 DDG</a>. Dieser Entwurf ersetzt keine individuelle Rechtsberatung.</p></main>${footer}</body></html>`);
await write("web/cookies.html", `<!doctype html><html lang="de"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex"/><title>Odin — Cookies & lokale Speicherung</title><link rel="stylesheet" href="/legal.css"/></head><body><header><a class="brand" href="/">odin↗</a><a href="/app">Workspace öffnen</a></header><main><span class="status">STAND · 12.09.2026</span><h1>Cookies & lokale Speicherung</h1><p>Odin verwendet im aktuellen Testbetrieb keine Marketing-, Werbe- oder Profiling-Cookies.</p><h2>Technisch notwendige Authentifizierung</h2><p>Für Anmeldung und sichere Sitzungen werden technisch notwendige Session-Cookies von Odin/Neon Auth eingesetzt. Sie sind für den angeforderten Login und den Schutz des Kontos erforderlich. Odin setzt zusätzlich kurzlebige, sichere OAuth-Session-Cookies ein, wenn ein OAuth-Login abgeschlossen wird.</p><h2>Eigenschaften</h2><ul><li>HTTPS/Secure für produktive Sitzungen.</li><li>HttpOnly für serverseitige Session-Cookies, soweit technisch vorgesehen.</li><li>SameSite-Beschränkungen gegen unerwünschte Cross-Site-Nutzung.</li><li>Keine Nutzung zu Werbe- oder Profilingzwecken.</li></ul><h2>Browser-Speicher</h2><p>Session-/Local-Storage kann für rein funktionale UI-Zustände wie Login-Rücksprung, zuletzt verwendete Eingaben oder Wiederaufnahme eines Flows eingesetzt werden. Geheimnisse und Provider-Tokens sollen dort nicht gespeichert werden.</p><h2>Einwilligung</h2><p>Solange Odin ausschließlich unbedingt erforderliche Technologien verwendet, wird kein Marketing-Cookie-Banner eingeblendet. Werden später Analytics, Marketing oder andere nicht notwendige Technologien ergänzt, werden diese vor Aktivierung einer gesonderten Einwilligungsprüfung nach § 25 TDDDG und der DSGVO unterzogen.</p><h2>Kontrolle</h2><p>Browser-Einstellungen können Cookies löschen oder blockieren. Werden notwendige Session-Cookies blockiert, kann die Anmeldung oder der Workspace nicht funktionieren.</p></main>${footer}</body></html>`);
await write("web/ai-act.html", `<!doctype html><html lang="de"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex"/><title>Odin — EU AI Act Transparenz</title><link rel="stylesheet" href="/legal.css"/></head><body><header><a class="brand" href="/">odin↗</a><a href="/app">Workspace öffnen</a></header><main><span class="status">EU AI ACT · STAND 12.09.2026</span><h1>KI-Transparenz & EU AI Act</h1><p class="notice"><strong>Transparenzhinweis:</strong> Odin ist ein KI-System. Nutzer interagieren in Chat, Research, Coding und Odin Bot mit KI-generierten Ausgaben und agentischen Werkzeugaufrufen. Diese Seite dokumentiert den technischen Umsetzungsstand; sie ist keine behördliche Konformitätsbescheinigung.</p><h2>Interaktion mit KI</h2><p>Odin weist im Workspace und in Odin Bot darauf hin, dass eine KI-Interaktion stattfindet. Modell/Provider, Werkzeugaktivität, Quellen, Dateiänderungen und Prüfstatus werden soweit technisch verfügbar sichtbar gemacht. Damit soll insbesondere die Transparenzpflicht für interaktive KI nach Art. 50 der Verordnung (EU) 2024/1689 unterstützt werden.</p><h2>Risikobasierter Einsatz</h2><p>Odin ist als allgemeiner Agent-Workspace für Wissensarbeit und Softwareentwicklung ausgelegt. Das Produkt ist nicht als System für verbotene Praktiken oder für ausschließlich automatisierte Entscheidungen mit rechtlicher bzw. ähnlich erheblicher Wirkung vorgesehen. Falls Odin künftig in einen Hochrisiko-Anwendungsfall integriert werden soll, ist vor Einsatz eine gesonderte Rollen-, Risiko- und Pflichtenprüfung erforderlich.</p><h2>Menschliche Kontrolle</h2><p>Repository-Auswahl, OAuth-Berechtigungen, Schreibmodi, Freigaben, Branch-/PR-Abläufe und kritische externe Aktionen werden als kontrollierte Grenzen behandelt. Technische Verifikation reduziert Risiken, ersetzt aber nicht die angemessene menschliche Prüfung produktionskritischer Ergebnisse.</p><h2>KI-generierte Inhalte</h2><p>Bei späteren Funktionen, die öffentliche synthetische Audio-, Bild-, Video- oder Textinhalte erzeugen oder veröffentlichen, müssen die jeweils anwendbaren Kennzeichnungs- und maschinenlesbaren Markierungspflichten aus Art. 50 gesondert umgesetzt werden. Der aktuelle Screenshot-Upload dient als Nutzereingabe und ist keine automatische öffentliche Veröffentlichung.</p><h2>Modelle Dritter / GPAI</h2><p>Odin kann Modelle externer Anbieter über NVIDIA oder UnoRouter aufrufen. Odin entwickelt diese zugrunde liegenden GPAI-Modelle nicht selbst. Die Rollen von Odin, Modellanbieter und Nutzer in der KI-Wertschöpfungskette werden vor kommerziellem Launch je Modell/Vertriebsszenario dokumentiert. Verpflichtungen der GPAI-Modellanbieter gelten seit 2. August 2025; die Durchsetzungsbefugnisse der Kommission gelten seit 2. August 2026.</p><h2>AI Literacy</h2><p>Produkttexte, Run-Details und Sicherheitsinformationen sollen Nutzer über Fähigkeiten, Grenzen und angemessene Kontrolle informieren. Für Organisationen, die Odin einsetzen, kann zusätzlich eine rollenbezogene Schulung erforderlich sein.</p><h2>Protokollierung und Nachvollziehbarkeit</h2><p>Odin protokolliert Missionszustände, Tool-Aktivität, Quellen, Änderungen und ausgewählte Verifikationsdaten. Diese Protokolle dienen der Nachvollziehbarkeit, Fehleranalyse und kontrollierten Wiederaufnahme; sie sind nicht als vollständige regulatorische Hochrisiko-Protokollierung zu verstehen, sofern ein solcher Anwendungsfall nicht ausdrücklich implementiert und geprüft wurde.</p><h2>Offene Launch-Gates</h2><ul><li>Verantwortlicher/Betreiber und Kontakt finalisieren.</li><li>Rollenbewertung pro produktivem Modell/Provider und Vertragskette dokumentieren.</li><li>AI-Act-Klassifizierung für konkrete Vermarktung und Zielgruppen rechtlich prüfen.</li><li>Falls öffentliche synthetische Inhalte eingeführt werden: Art.-50-Markierung/Disclosure technisch ergänzen.</li></ul><p>Offizielle Quellen: <a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj">Verordnung (EU) 2024/1689</a> · <a href="https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems">EU-Kommission: Art.-50-Transparenzleitlinien</a> · <a href="https://digital-strategy.ec.europa.eu/en/policies/guidelines-gpai-providers">EU-Kommission: GPAI-Leitlinien</a>.</p></main>${footer}</body></html>`);

// Update imprint/gdpr footer links without inventing operator identity.
for (const path of ["web/imprint.html", "web/gdpr.html"]) {
  let text = await read(path);
  text = text.replace(/<footer>[\s\S]*?<\/footer>/u, footer);
  await write(path, text);
}
