import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

async function patch(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  assert.notEqual(after, before, `NO_CHANGE:${path}`);
  await writeFile(path, after);
}

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  assert(first >= 0, `MISSING:${label}`);
  assert.equal(text.indexOf(before, first + before.length), -1, `AMBIGUOUS:${label}`);
  return text.slice(0, first) + after + text.slice(first + before.length);
}

await patch("src/chat/hosted.ts", (text) => {
  const start = text.indexOf("  const models: ChatModel[] = [];");
  const endMarker = "  return { pool, auth, models };";
  const end = text.indexOf(endMarker, start);
  assert(start >= 0 && end > start, "HOSTED_MODEL_BLOCK");
  const replacement = `  const models: ChatModel[] = [];
  const addNvidiaModel = (input: {
    id: string;
    label: string;
    model: string;
    plan: "free" | "pro" | "ultra";
    summary: string;
    recommendedFor: readonly string[];
    credential: () => string;
    version: string;
    reference: string;
    capabilities: ReturnType<typeof makeCapabilities>;
    timeoutMs: number;
  }) => {
    if (!input.credential()) return;
    const capabilities = new CapabilityRegistry([
      {
        model: input.model,
        provider: "nvidia",
        version: input.version,
        provenance: {
          kind: "provider",
          observedAt: "2026-09-09T00:00:00.000Z",
          reference: input.reference,
        },
        capabilities: input.capabilities,
      },
    ]);
    models.push({
      id: input.id,
      label: input.label,
      model: input.model,
      plan: input.plan,
      summary: input.summary,
      recommendedFor: input.recommendedFor,
      provider: new NvidiaProvider({
        capabilities,
        credential: input.credential,
        reasoningParameter: "reasoning_effort",
        defaultTimeoutMs: input.timeoutMs,
      }),
    });
  };
  addNvidiaModel({
    id: "kimi",
    label: "Kimi K3",
    model: "moonshotai/kimi-k3",
    plan: "free",
    summary: "Großer Kontext für Coding, Reasoning und lange Aufgaben.",
    recommendedFor: ["Coding", "Thinking", "Long context"],
    credential: () => process.env.NV_API_KEY ?? process.env.NVIDIA_API_KEY ?? "",
    version: "nvidia-build-2026-09-04",
    reference: "https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k3-infer",
    capabilities: makeCapabilities({
      textInput: true,
      toolUse: true,
      streaming: true,
      reasoningEfforts: ["low", "high", "max"],
      contextWindowTokens: 1048576,
      maxOutputTokens: 65536,
    }),
    timeoutMs: 180000,
  });
  addNvidiaModel({
    id: "muse-glimmer",
    label: "Muse Glimmer 30B",
    model: "meta/muse-glimmer-30b",
    plan: "pro",
    summary: "Multimodales Reasoning-Modell für agentische Aufgaben, Coding und Tool-Nutzung.",
    recommendedFor: ["Pro", "Coding", "Agents", "Vision", "Tool use"],
    credential: () => process.env.NV_API_KEY_2 ?? process.env.NV_PRO_API_KEY ?? "",
    version: "nvidia-build-2026-09-09",
    reference: "https://docs.api.nvidia.com/nim/re/reference/meta-muse-glimmer-30b-infer",
    capabilities: makeCapabilities({
      textInput: true,
      imageInput: true,
      toolUse: true,
      streaming: true,
      temperature: true,
      reasoningEfforts: ["minimal", "low", "medium", "high", "max"],
      contextWindowTokens: 131072,
      maxOutputTokens: 8192,
    }),
    timeoutMs: 120000,
  });
  console.info("Odin backend readiness", {
    databaseConfigured: true,
    authConfigured: true,
    modelCount: models.length,
    modelIds: models.map((model) => model.id),
  });
`;
  return text.slice(0, start) + replacement + text.slice(end);
});

await patch("src/chat/engine.ts", (text) =>
  replaceOnce(
    text,
    `        model: model.model,
        profile: model.provider.capabilities(model.model),`,
    `        model: model.model,
        plan: model.plan ?? "free",
        summary: model.summary ?? "",
        recommendedFor: [...(model.recommendedFor ?? [])],
        profile: model.provider.capabilities(model.model),`,
    "ENGINE_MODEL_METADATA",
  ),
);

await patch(".env.example", (text) =>
  replaceOnce(
    text,
    "NVIDIA_API_KEY=\n",
    "NVIDIA_API_KEY=\n# Dedicated server-side credential for the Pro preview model. Never expose it to clients.\nNV_API_KEY_2=\n",
    "ENV_PRO_KEY",
  ),
);

await patch("scripts/configure-vercel-preview.mjs", (text) => {
  let next = text.replaceAll("agent/chathub-modes-evidence", "agent/mno-product-workspace-pro-preview");
  next = next.replaceAll("odin_app", "odin_mno_app");
  next = replaceOnce(
    next,
    `for (const key of ["VERCEL_TOKEN", "NEON_API_KEY", "NV_API_KEY"])`,
    `for (const key of ["VERCEL_TOKEN", "NEON_API_KEY", "NV_API_KEY", "NV_API_KEY_2"])`,
    "PREVIEW_REQUIRED_KEYS",
  );
  next = replaceOnce(
    next,
    `assert(["ODIN_DATABASE_URL", "NEON_AUTH_BASE_URL", "NV_API_KEY"].includes(key));`,
    `assert(["ODIN_DATABASE_URL", "NEON_AUTH_BASE_URL", "NV_API_KEY", "NV_API_KEY_2"].includes(key));`,
    "PREVIEW_ALLOWED_KEYS",
  );
  next = replaceOnce(
    next,
    `      previewVariable("NV_API_KEY", process.env.NV_API_KEY),`,
    `      previewVariable("NV_API_KEY", process.env.NV_API_KEY),
      previewVariable("NV_API_KEY_2", process.env.NV_API_KEY_2),`,
    "PREVIEW_MODEL_KEYS",
  );
  next = next.replace(
    "Database, Auth and NVIDIA credentials set only for the approved preview branch",
    "Database, Auth and both NVIDIA credentials set only for the approved preview branch",
  );
  return next;
});

await patch(".github/workflows/configure-vercel-preview.yml", (text) => {
  let next = text.replaceAll("agent/chathub-modes-evidence", "agent/mno-product-workspace-pro-preview");
  next = replaceOnce(
    next,
    `          NV_API_KEY: \${{ secrets.NV_API_KEY }}
          FREE_API_KEY: \${{ secrets.FREE_API_KEY }}`,
    `          NV_API_KEY: \${{ secrets.NV_API_KEY }}
          NV_API_KEY_2: \${{ secrets.NV_API_KEY_2 }}
          FREE_API_KEY: \${{ secrets.FREE_API_KEY }}`,
    "WORKFLOW_PRO_KEY",
  );
  return next;
});

await patch("web/chat.js", (text) => {
  let next = replaceOnce(
    text,
    `function showChat() {
  $("benchmarks").hidden = true;
  $("chat-layout").hidden = false;
  $("chat-view").classList.add("selected");
  $("benchmark-view").classList.remove("selected");
}`,
    `function showChat() {
  $("benchmarks").hidden = true;
  $("models-panel").hidden = true;
  $("system-panel").hidden = true;
  $("chat-layout").hidden = false;
  $("chat-view").classList.add("selected");
  $("benchmark-view").classList.remove("selected");
  $("models-view").classList.remove("selected");
  $("system-view").classList.remove("selected");
}`,
    "SHOW_CHAT_SURFACES",
  );
  next = replaceOnce(
    next,
    `    const option = element("option", model.label);
    option.value = model.id;`,
    `    const tier = model.plan ? model.plan.toUpperCase() : "MODEL";
    const option = element("option", \`${"${model.label} · ${tier}"}\`);
    option.value = model.id;`,
    "MODEL_OPTION_LABEL",
  );
  next = replaceOnce(
    next,
    `  $("workspace-status").textContent = config.workspace
    ? config.workspace.writable
      ? "Workspace connected"
      : "Workspace · read only"
    : "No workspace connected";`,
    `  $("workspace-status").textContent = config.workspace
    ? config.workspace.writable
      ? "Workspace verbunden"
      : "Workspace · nur lesen"
    : "Workspace nicht verbunden";
  $("model-count-nav").textContent = String(config.models.length);`,
    "WORKSPACE_STATUS",
  );
  next = next.replaceAll('$("page-title").textContent = "Chathub";', '$("page-title").textContent = "Mission";');
  next = next.replaceAll('step.status === "done" ? "✓" : step.status === "active" ? "→" : "·"', 'step.status === "done" ? "DONE" : step.status === "active" ? "RUN" : "WAIT"');
  return next;
});

await patch("web/product-info.js", (text) => {
  let next = text.replaceAll(" ↗", "");
  next = replaceOnce(
    next,
    `async function openBenchmarks() {
  byId("chat-layout").hidden = true;
  byId("benchmarks").hidden = false;`,
    `async function openBenchmarks() {
  byId("chat-layout").hidden = true;
  byId("models-panel").hidden = true;
  byId("system-panel").hidden = true;
  byId("benchmarks").hidden = false;`,
    "BENCHMARK_SURFACES",
  );
  next = replaceOnce(
    next,
    `  byId("benchmark-view").classList.add("selected");
  byId("chat-view").classList.remove("selected");`,
    `  byId("benchmark-view").classList.add("selected");
  byId("chat-view").classList.remove("selected");
  byId("models-view").classList.remove("selected");
  byId("system-view").classList.remove("selected");`,
    "BENCHMARK_NAV",
  );
  next += `

function surface(id, title, nav) {
  byId("chat-layout").hidden = true;
  byId("benchmarks").hidden = true;
  byId("models-panel").hidden = id !== "models-panel";
  byId("system-panel").hidden = id !== "system-panel";
  byId("page-title").textContent = title;
  for (const buttonId of ["chat-view", "models-view", "system-view", "benchmark-view"])
    byId(buttonId)?.classList.toggle("selected", buttonId === nav);
}

function modelCard(model) {
  const item = node("article", undefined, "product-model-card");
  const top = node("div", undefined, "product-card-top");
  top.append(node("span", (model.plan ?? "model").toUpperCase(), "plan-status"), node("span", model.provider.toUpperCase(), "info-eyebrow"));
  item.append(top, node("h3", model.label), node("code", model.model));
  if (model.summary) item.append(node("p", model.summary, "muted"));
  const capabilities = [];
  const profile = model.profile?.capabilities ?? {};
  if (profile.contextWindowTokens) capabilities.push(\`Kontext: \${profile.contextWindowTokens.toLocaleString()} Tokens\`);
  if (profile.imageInput) capabilities.push("Bild + Text");
  if (profile.toolUse) capabilities.push("Tool-Nutzung");
  if (profile.streaming) capabilities.push("Streaming");
  if (profile.reasoningEfforts?.length) capabilities.push(\`Reasoning: \${profile.reasoningEfforts.join(", ")}\`);
  if (model.recommendedFor?.length) capabilities.push(\`Geeignet für: \${model.recommendedFor.join(", ")}\`);
  addList(item, capabilities.length ? capabilities : ["Capability-Profil ist verbunden."]);
  const use = node("button", "In Mission verwenden", "model-use");
  use.type = "button";
  use.onclick = () => {
    byId("model").value = model.id;
    byId("chat-view").click();
    byId("prompt").focus();
  };
  item.append(use);
  return item;
}

async function openModels() {
  surface("models-panel", "Modelle", "models-view");
  const target = byId("model-cards");
  target.replaceChildren(node("p", "Lade serverseitig verbundene Modelle …", "muted"));
  try {
    const config = await request("/api/config");
    target.replaceChildren();
    if (!config.models?.length) {
      target.append(node("p", "Kein Modell ist serverseitig verbunden. Provider-Schlüssel bleiben ausschließlich im Control Plane.", "empty-product-state"));
      return;
    }
    for (const model of config.models) target.append(modelCard(model));
  } catch (error) {
    target.replaceChildren(node("p", \`Modelle konnten nicht geladen werden: \${error.message}\`, "empty-product-state"));
  }
}

function statusCard(name, state, copy) {
  const item = node("article", undefined, "system-card");
  item.append(node("span", state, "plan-status"), node("h3", name), node("p", copy, "muted"));
  return item;
}

async function openSystem() {
  surface("system-panel", "Odin System", "system-view");
  const target = byId("system-content");
  target.replaceChildren(node("p", "Prüfe Produktstatus …", "muted"));
  let config = null;
  try { config = await request("/api/config"); } catch {}
  target.replaceChildren(
    statusCard("Mission Runtime", "LIVE", "Plan, Zustände, Budgets, Pause, Fortsetzen, Stoppen und wiederaufnehmbare Missionen."),
    statusCard("Model Control", config?.models?.length ? "LIVE" : "NICHT VERBUNDEN", config?.models?.length ? \`\${config.models.length} Modellroute(n) sind serverseitig verbunden.\` : "Keine Provider-Credentials sind in diesem Deployment aktiv."),
    statusCard("Coding Workspace", config?.workspace?.writable ? "LIVE" : "BEGRENZT", "Dateiänderungen, Diffs und isolierte HTML-Vorschau mit serverseitiger Workspace-Grenze."),
    statusCard("Verification", "LIVE", "Qualitätsgates, Review und Evidenz bleiben vom Modelloutput getrennt."),
    statusCard("Research", config?.research ? "LIVE" : "NICHT VERBUNDEN", config?.research ? \`Aktiver Adapter: \${config.research}.\` : "Kein Research-Adapter verbunden."),
    statusCard("Auth + RLS", config?.user ? "LIVE", "Neon Auth, serverseitige Sessions und nutzergebundener Postgres-Kontext." : "ANMELDUNG ERFORDERLICH", "Neon Auth und RLS werden serverseitig erzwungen."),
    statusCard("Skills + Memory + Tool OS", "CORE", "Die verifizierten Odin-Kernmodule bleiben unter Runtime-Autorität. Diese Preview zeigt ihren Status, ohne Client oder Modell zusätzliche Berechtigungen zu geben."),
  );
}

byId("models-view")?.addEventListener("click", () => void openModels());
byId("system-view")?.addEventListener("click", () => void openSystem());
`;
  return next;
});

await patch("web/chat.css", (text) => text + `

/* M–O product surfaces */
.product-surface {
  overflow: auto;
  padding: 42px 46px 70px;
  min-height: 0;
}
.product-surface-header {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(240px, 0.6fr);
  gap: 28px;
  align-items: end;
  border-bottom: 1px solid var(--line);
  padding-bottom: 28px;
  margin-bottom: 28px;
}
.product-surface-header h1 {
  margin: 8px 0 0;
  max-width: 720px;
  font-size: clamp(34px, 5vw, 68px);
  line-height: 0.98;
  letter-spacing: -0.055em;
  font-weight: 480;
}
.product-surface-header p { margin: 0; }
.product-card-grid,
#system-content {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.product-model-card,
.system-card {
  border: 1px solid var(--line);
  background: #17191d;
  padding: 22px;
  border-radius: 12px;
}
.product-model-card h3,
.system-card h3 { font-size: 22px; font-weight: 520; margin: 16px 0 8px; }
.product-model-card code { color: #8f9bad; font-size: 10px; overflow-wrap: anywhere; }
.product-card-top { display: flex; justify-content: space-between; align-items: center; }
.product-model-card .info-list { padding-left: 18px; color: #9aa4b5; font-size: 11px; line-height: 1.8; }
.model-use { width: 100%; margin-top: 14px; background: #e0e8fa; color: #202938; border: 0; }
.empty-product-state { border: 1px solid #59473f; background: #241c18; padding: 20px; border-radius: 10px; color: #d6b8aa; }
#settings { width: auto; white-space: nowrap; }
#send svg { width: 18px; height: 18px; display: block; margin: auto; }
.step-marker { min-width: 34px; font-size: 8px; letter-spacing: .6px; }
@media (max-width: 900px) {
  .product-surface { padding: 30px 24px 60px; }
  .product-surface-header { grid-template-columns: 1fr; }
  .product-card-grid, #system-content { grid-template-columns: 1fr; }
}
`);

await patch("web/landing.html", (text) => text.replaceAll("↗", ""));
await patch("web/landing.js", (text) => text.replaceAll(" ↗", ""));

console.log("M–O product patch applied");
