const byId = (id) => document.getElementById(id);

function node(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function safeLink(url, text, className) {
  const item = node("a", text, className);
  try {
    const parsed = new URL(url, window.location.origin);
    if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) {
      item.href = parsed.href;
      if (parsed.origin !== window.location.origin) {
        item.target = "_blank";
        item.rel = "noopener noreferrer";
      }
    }
  } catch {
    item.removeAttribute("href");
  }
  return item;
}

async function request(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(path, {
    credentials: "same-origin",
    method,
    headers: {
      "X-Odin-Request": "1",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? "Request failed");
  return data;
}

function actionButton(label, action) {
  const button = node("button", label);
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      window.alert(error.message);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function accountCard(config) {
  const item = card("Konto", "ACCOUNT");
  addList(item, [
    `E-Mail: ${config?.user?.email ?? "nicht verfügbar"}`,
    `Plan: ${(config?.account?.plan ?? "free").toUpperCase()}`,
    `Abo-Status: ${config?.account?.subscriptionStatus ?? "free"}`,
    config?.account?.cancelAtPeriodEnd
      ? "Kündigung zum Periodenende vorgemerkt"
      : "Keine Kündigung vorgemerkt",
  ]);
  item.append(
    actionButton("Daten exportieren", async () => {
      const exported = await request("/api/account/export");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(
        new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }),
      );
      link.download = "odin-data-export.json";
      link.click();
      URL.revokeObjectURL(link.href);
    }),
    actionButton("Konto-Daten löschen", async () => {
      if (!window.confirm("Alle Odin-Daten unwiderruflich löschen und abmelden?")) return;
      await request("/api/account", {}, "DELETE");
      window.location.assign("/app");
    }),
  );
  return item;
}

function githubCard(config) {
  const item = card("GitHub Workspace", "GITHUB");
  const github = config?.github;
  addList(
    item,
    github?.connected
      ? [
          `Verbunden als ${github.login}`,
          `Repository: ${github.repository ?? "noch nicht gewählt"}`,
          `Branch: ${github.defaultBranch ?? "—"}`,
          "Coding schreibt ausschließlich auf einen isolierten odin/* Arbeitsbranch.",
        ]
      : ["Nicht verbunden", "OAuth fordert Repository-Zugriff nur nach deiner Freigabe an."],
  );
  item.append(
    actionButton(github?.connected ? "Repositories laden" : "GitHub verbinden", async () => {
      if (!github?.connected) {
        window.location.assign("/api/github/connect");
        return;
      }
      const result = await request("/api/github/repositories");
      const select = node("select");
      for (const repository of result.repositories) {
        const option = node(
          "option",
          `${repository.fullName}${repository.private ? " · privat" : ""}`,
        );
        option.value = repository.fullName;
        option.dataset.branch = repository.defaultBranch;
        select.append(option);
      }
      const save = actionButton("Repository auswählen", async () => {
        const option = select.selectedOptions[0];
        await request(
          "/api/github/repository",
          { repository: select.value, branch: option.dataset.branch },
          "PUT",
        );
        await openSettings();
      });
      item.append(select, save);
    }),
  );
  if (github?.connected)
    item.append(
      actionButton("GitHub trennen", async () => {
        await request("/api/github", {}, "DELETE");
        await openSettings();
      }),
    );
  return item;
}

function providersCard(config) {
  const item = card("Model Provider", "SECURE BYOK");
  const connected = new Map((config?.providers ?? []).map((entry) => [entry.provider, entry]));
  for (const id of ["openai", "anthropic", "openrouter", "nvidia", "google"]) {
    const row = node("div", undefined, "provider-row");
    const known = connected.get(id);
    row.append(
      node("strong", id.toUpperCase()),
      node("span", known ? `Verbunden · …${known.fingerprint}` : "Nicht verbunden"),
    );
    const input = node("input");
    input.type = "password";
    input.autocomplete = "off";
    input.placeholder = known ? "Neuen Schlüssel einsetzen" : "API-Schlüssel";
    input.setAttribute("aria-label", `${id} API key`);
    row.append(
      input,
      actionButton(known ? "Ersetzen" : "Verbinden", async () => {
        await request(`/api/providers/${id}`, { key: input.value }, "PUT");
        input.value = "";
        await openSettings();
      }),
    );
    if (known)
      row.append(
        actionButton("Entfernen", async () => {
          await request(`/api/providers/${id}`, {}, "DELETE");
          await openSettings();
        }),
      );
    item.append(row);
  }
  item.append(
    node(
      "p",
      "Schlüssel werden vor dem Speichern über einen nicht-generierenden Provider-Endpunkt geprüft, verschlüsselt gespeichert und nie wieder an den Browser ausgegeben.",
      "muted",
    ),
  );
  return item;
}

function billingCard(config) {
  const item = card("Billing", "FREE / PRO / DEVELOPER / ULTRA");
  item.append(
    node(
      "p",
      "Der Webhook und die Datenbank bestimmen den Plan. Eine Rückkehr von Checkout schaltet keine Berechtigung frei.",
      "info-lead",
    ),
  );
  const prices = { pro: "$9.99 / month", developer: "$19.99 / month", ultra: "$49.99 / month" };
  for (const plan of ["pro", "developer", "ultra"]) {
    const configured = config?.billing?.[`${plan}CheckoutConfigured`];
    item.append(
      actionButton(
        configured
          ? `${plan.toUpperCase()} · ${prices[plan]}`
          : `${plan.toUpperCase()} · Checkout nicht konfiguriert`,
        async () => {
          const result = await request("/api/billing/checkout", { plan });
          window.location.assign(result.url);
        },
      ),
    );
    item.lastElementChild.disabled = !configured;
  }
  item.append(
    actionButton("Billing verwalten", async () => {
      const result = await request("/api/billing/portal", {});
      window.location.assign(result.url);
    }),
  );
  return item;
}

function card(title, eyebrow) {
  const item = node("section", undefined, "info-card");
  if (eyebrow) item.append(node("span", eyebrow, "info-eyebrow"));
  item.append(node("h3", title));
  return item;
}

function addList(parent, values, ordered = false) {
  const list = node(ordered ? "ol" : "ul", undefined, ordered ? "odin-steps" : "info-list");
  for (const value of values) list.append(node("li", value));
  parent.append(list);
}

const workflow = [
  [
    "01",
    "Aufgabe verstehen",
    "Ziel, Grenzen und gewünschtes Ergebnis werden in einen kontrollierten Auftrag übersetzt.",
  ],
  [
    "02",
    "Kontext zusammenstellen",
    "Aktuelle Aufgabe, freigegebene Dateien, relevante Historie und Belege werden priorisiert statt blind alles mitzuschicken.",
  ],
  [
    "03",
    "Modell auswählen",
    "Odin darf nur Routen nutzen, die Fähigkeiten und empirische Qualitätsgrenzen erfüllen. Kosten und Tempo zählen erst danach.",
  ],
  [
    "04",
    "Planen",
    "Komplexe Aufgaben werden in begrenzte, überprüfbare Schritte zerlegt. Der Plan selbst erteilt keine Berechtigung.",
  ],
  [
    "05",
    "Werkzeuge kontrolliert nutzen",
    "Datei-, Research- oder andere Aktionen laufen nur durch die freigegebene Tool-Policy mit Scope, Limits und Audit.",
  ],
  [
    "06",
    "Prüfen und reparieren",
    "Ergebnisse werden gegen passende Evidenz geprüft. Bei einem begrenzten Fehler kann Odin gezielt reparieren oder eskalieren.",
  ],
  [
    "07",
    "Fortsetzen und belegen",
    "Mission, Fortschritt und Events bleiben wiederaufnehmbar. Das Ergebnis zeigt Nachweise und offene Grenzen statt versteckter Erfolgsmeldungen.",
  ],
];

function workflowCard() {
  const item = card("So arbeitet Odin", "RUNTIME / STEP BY STEP");
  const intro = node(
    "p",
    "Das Modell schlägt vor. Odin entscheidet deterministisch über Berechtigungen, Budgets, Werkzeuge, Routing und Verifikation.",
    "info-lead",
  );
  item.append(intro);
  const list = node("ol", undefined, "workflow-list");
  for (const [number, title, copy] of workflow) {
    const row = node("li");
    row.append(node("span", number, "workflow-number"));
    const content = node("div");
    content.append(node("strong", title), node("p", copy));
    row.append(content);
    list.append(row);
  }
  item.append(list);
  return item;
}

function connectionCard(config) {
  const item = card("Aktuelle Verbindungen", "PREVIEW / LIVE CONFIG");
  const workspace = config?.workspace
    ? `${config.workspace.writable ? "Lesen + Schreiben" : "Nur Lesen"} · ${config.workspace.kind ?? "Workspace"}`
    : "Nicht verbunden";
  const models = config?.models?.map((model) => model.label).join(", ") || "Kein Modell verfügbar";
  addList(item, [
    `Workspace: ${workspace}`,
    `Research: ${config?.research ?? "nicht verbunden"}`,
    `Modelle: ${models}`,
    "Provider-Credentials bleiben serverseitig und werden nicht an den Browser ausgegeben.",
  ]);
  return item;
}

function legalCard() {
  const item = card("Datenschutz & Recht", "TRANSPARENZ");
  item.append(
    node(
      "p",
      "Die Rechtstexte sind Preview-Entwürfe. Betreiberangaben, Auftragsverarbeiter, Löschfristen und die rechtliche Prüfung bleiben Launch-Gates.",
      "info-lead",
    ),
  );
  const links = node("nav", undefined, "legal-links");
  links.setAttribute("aria-label", "Rechtliche Informationen");
  for (const [url, label] of [
    ["/privacy.html", "Datenschutzerklärung"],
    ["/eula.html", "Nutzungsbedingungen / EULA"],
    ["/gdpr.html", "DSGVO-Readiness"],
    ["/imprint.html", "Impressum – noch zu vervollständigen"],
  ])
    links.append(safeLink(url, `${label}`));
  item.append(links);
  return item;
}

async function openSettings() {
  const body = byId("details-body");
  body.replaceChildren(node("p", "Lade aktuelle Konfiguration …", "info-lead"));
  byId("connection-details").showModal();
  let config = null;
  try {
    config = await request("/api/config");
  } catch {
    // The explanatory and legal surfaces stay available even if a connection is temporarily unavailable.
  }
  body.replaceChildren(
    accountCard(config),
    githubCard(config),
    providersCard(config),
    billingCard(config),
    workflowCard(),
    connectionCard(config),
    legalCard(),
  );
}

function metric(title, value, detail) {
  const item = node("article", undefined, "metric-card");
  item.append(node("span", title), node("strong", value), node("small", detail));
  return item;
}

function progressChart(title, rows, max, note) {
  const section = node("section", undefined, "chart-card");
  section.append(node("h2", title));
  if (note) section.append(node("p", note, "muted"));
  for (const row of rows) {
    const line = node("div", undefined, "chart-row");
    const heading = node("div", undefined, "chart-heading");
    heading.append(node("span", row.label), node("strong", row.display ?? String(row.value)));
    const bar = document.createElement("progress");
    bar.max = max;
    bar.value = row.value;
    bar.setAttribute("aria-label", `${row.label}: ${row.display ?? row.value}`);
    line.append(heading, bar);
    section.append(line);
  }
  return section;
}

function evidenceTable(headers, rows) {
  const table = node("table", undefined, "evidence-table");
  const head = node("thead");
  const heading = node("tr");
  for (const label of headers) heading.append(node("th", label));
  head.append(heading);
  const body = node("tbody");
  for (const values of rows) {
    const row = node("tr");
    for (const value of values) row.append(node("td", String(value)));
    body.append(row);
  }
  table.append(head, body);
  return table;
}

function renderModelComparison(target, comparison) {
  const section = node("section", undefined, "evidence-section-card");
  section.append(
    node("span", "ODIN LIVE ACQUISITION", "info-eyebrow"),
    node("h2", "Kimi allein vs. Kimi + Odin"),
  );
  if (!comparison?.summary) {
    section.append(node("p", "Kein gemessener Modellvergleich verfügbar.", "muted"));
    target.append(section);
    return;
  }
  const complete = comparison.cases.filter((item) => item.baseline.complete && item.odin.complete);
  const tokens = (arm) =>
    complete.reduce((total, item) => total + (item[arm].usage?.totalTokens ?? 0), 0);
  const summary = comparison.summary;
  const completePairs = summary.completePairs;
  const baselineAccuracy = completePairs ? (summary.baselinePassed / completePairs) * 100 : 0;
  const odinAccuracy = completePairs ? (summary.odinPassed / completePairs) * 100 : 0;
  const grid = node("div", undefined, "benchmark-grid");
  grid.append(
    metric("Vollständige Paare", `${completePairs}/${summary.totalCases}`, comparison.status),
    metric(
      "Gemessener Accuracy-Lift",
      `${(odinAccuracy - baselineAccuracy).toFixed(1)} pp`,
      "Nur vollständige Paare",
    ),
    metric(
      "Provider Calls",
      String(summary.providerCalls),
      "Eine Acquisition, keine versteckten Retries",
    ),
  );
  section.append(
    grid,
    progressChart(
      "Genauigkeit auf vollständigen Paaren",
      [
        {
          label: "Kimi allein",
          value: baselineAccuracy,
          display: `${baselineAccuracy.toFixed(1)}%`,
        },
        { label: "Kimi + Odin", value: odinAccuracy, display: `${odinAccuracy.toFixed(1)}%` },
      ],
      100,
      "Gleiche Aufgaben. Unvollständige Provider-/Infrastrukturpaare werden nicht als Nullscore umgedeutet.",
    ),
    progressChart(
      "Token-Aufwand auf vollständigen Paaren",
      [
        {
          label: "Kimi allein",
          value: tokens("baseline"),
          display: tokens("baseline").toLocaleString(),
        },
        { label: "Kimi + Odin", value: tokens("odin"), display: tokens("odin").toLocaleString() },
      ],
      Math.max(tokens("baseline"), tokens("odin"), 1),
      "Mehr Orchestrierung kann mehr Modellaufrufe und Tokens kosten. Odin darf Effizienz nicht als Qualitätsgewinn ausgeben.",
    ),
  );
  const rows = comparison.cases.map((item) => [
    item.id,
    item.baseline.complete
      ? item.baseline.passed
        ? "Korrekt"
        : "Falsch"
      : `Nicht gemessen (${item.baseline.state})`,
    item.odin.complete
      ? item.odin.passed
        ? "Korrekt"
        : "Falsch"
      : `Nicht gemessen (${item.odin.state})`,
  ]);
  section.append(evidenceTable(["Aufgabe", "Kimi allein", "Kimi + Odin"], rows));
  if (comparison.runId)
    section.append(
      safeLink(
        `https://github.com/clarityosbaerbelwesterop-gif/Odin-Agent-/actions/runs/${comparison.runId}`,
        "Original-Run öffnen",
        "evidence-source",
      ),
    );
  target.append(section);
}

function renderProtocolComparison(target, result) {
  const section = node("section", undefined, "evidence-section-card");
  section.append(
    node("span", "HISTORISCHE M16-EVIDENZ", "info-eyebrow"),
    node("h2", "Grounded coding protocol"),
  );
  const value = result?.selectedSummary;
  if (!value) {
    section.append(node("p", "Keine M16-Protokollevidenz verfügbar.", "muted"));
    target.append(section);
    return;
  }
  const grid = node("div", undefined, "benchmark-grid");
  grid.append(
    metric(
      "Odin abgeschlossen",
      `${value.candidateCompleted}/${value.completePairs}`,
      `Baseline ${value.baselineCompleted}/${value.completePairs}`,
    ),
    metric(
      "Weniger Tokens",
      `${(value.tokenReductionBps / 100).toFixed(1)}%`,
      "Nur matched measurable tasks",
    ),
    metric(
      "Qualitätsdifferenz",
      `+${(value.qualityLiftBps / 100).toFixed(1)} pp`,
      "Kleiner Coding-Protokollvergleich",
    ),
  );
  section.append(
    grid,
    node(
      "p",
      "Das ist kein Modell-allein-vs.-Modell+Odin-Test. Verglichen wurden zwei Coding-Protokolle mit Kimi. Der Wert darf nicht als universeller Modell-Lift vermarktet werden.",
      "muted",
    ),
  );
  target.append(section);
}

function renderBlueprint(target, blueprint) {
  if (!blueprint?.domains) return;
  const section = node("section", undefined, "evidence-section-card");
  section.append(
    node("span", "BENCHMARK 2.0", "info-eyebrow"),
    node("h2", "100 Fälle · acht Domänen"),
    progressChart(
      "Protokoll-Abdeckung",
      blueprint.domains.map((domain) => ({
        label: domain.name,
        value: domain.cases,
        display: `${domain.cases} Fälle`,
      })),
      25,
      "Diese Balken zeigen ausschließlich die festgelegte Testverteilung – keinen live erzielten Modellscore.",
    ),
    node("p", blueprint.note, "muted"),
  );
  target.append(section);
}

function renderFrontier(target, reference, gpt55) {
  const section = node("section", undefined, "evidence-section-card frontier-reference");
  section.append(
    node("span", "EXTERNE REFERENZ · NICHT ODIN", "info-eyebrow"),
    node("h2", "Frontier-Modelle im veröffentlichten Vergleich"),
    node(
      "p",
      "Diese Werte stammen aus der von OpenAI veröffentlichten Astra-Tabelle. Sie dienen nur zur Einordnung und wurden nicht mit dem Odin-Harness erzeugt.",
      "muted",
    ),
  );
  if (reference?.benchmarks) {
    section.append(
      evidenceTable(
        ["Benchmark", "GPT-6 Astra", "GPT-5.6 Sol", "Claude Fable 5.1"],
        reference.benchmarks.map((item) => [
          item.name,
          `${item.scores["GPT-6 Astra"]}%`,
          `${item.scores["GPT-5.6 Sol"]}%`,
          `${item.scores["Claude Fable 5.1"]}%`,
        ]),
      ),
    );
    const gaps = reference.gapsToAstraForSol ?? [];
    section.append(
      progressChart(
        "GPT-5.6 Sol → Astra: veröffentlichte Lücke",
        gaps.map((gap) => ({
          label: gap.benchmark,
          value: gap.percentagePoints,
          display: `${gap.percentagePoints.toFixed(1)} pp`,
        })),
        Math.max(...gaps.map((gap) => gap.percentagePoints), 1),
        "Das ist die zu schließende Differenz in derselben veröffentlichten Tabelle – kein Nachweis, dass Odin sie bereits schließt.",
      ),
      safeLink(reference.source.url, "Quelle: OpenAI GPT-6 Astra", "evidence-source"),
    );
  }
  const targetCard = node("div", undefined, "target-card");
  targetCard.append(
    node("strong", "Kann GPT-5.5 + Odin GPT-6-Astra-Niveau erreichen?"),
    node("span", "ZIELHYPOTHESE · NICHT BEWIESEN", "plan-status"),
    node(
      "p",
      "Noch nicht seriös belegbar. GPT-5.5 wurde unter anderem auf Terminal-Bench 2.0 veröffentlicht; Astra wird hier auf Terminal-Bench 4.0 ausgewiesen. Unterschiedliche Benchmark-Versionen werden nicht gegeneinander verrechnet. Dafür braucht Odin einen identischen Suite-/Harness-/Budget-A/B-Lauf.",
    ),
  );
  if (gpt55?.source?.url)
    targetCard.append(safeLink(gpt55.source.url, "Quelle: OpenAI GPT-5.5", "evidence-source"));
  section.append(targetCard);
  target.append(section);
}

async function openBenchmarks() {
  byId("chat-layout").hidden = true;
  byId("models-panel").hidden = true;
  byId("system-panel").hidden = true;
  byId("benchmarks").hidden = false;
  byId("page-title").textContent = "Benchmarks";
  byId("benchmark-view").classList.add("selected");
  byId("chat-view").classList.remove("selected");
  byId("models-view").classList.remove("selected");
  byId("system-view").classList.remove("selected");
  const target = byId("benchmark-content");
  target.replaceChildren(node("p", "Lade verifizierbare Evidenz …", "muted"));
  try {
    const evidence = await request("/api/benchmarks");
    target.replaceChildren();
    const notice = node("aside", undefined, "evidence-notice");
    notice.append(
      node("strong", "Drei Evidenzklassen"),
      node(
        "p",
        "Live Odin-Runs, historische Odin-Protokolltests und externe Herstellerwerte bleiben getrennt. Nur gleiche Benchmarks, Versionen, Harnesses und Budgets dürfen als direkte Verbesserung verglichen werden.",
      ),
    );
    target.append(notice);
    renderModelComparison(target, evidence.modelComparison);
    renderProtocolComparison(target, evidence.protocolComparison);
    renderBlueprint(target, evidence.benchmarkBlueprint);
    renderFrontier(target, evidence.externalFrontier, evidence.gpt55Reference);
  } catch (error) {
    target.replaceChildren(
      node("p", `Benchmark-Evidenz konnte nicht geladen werden: ${error.message}`, "muted"),
    );
  }
}

const settings = byId("settings");
if (settings) {
  settings.setAttribute("aria-label", "Einstellungen und Informationen");
  settings.onclick = () => void openSettings();
}
const benchmark = byId("benchmark-view");
if (benchmark) benchmark.onclick = () => void openBenchmarks();

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
  top.append(
    node("span", (model.plan ?? "model").toUpperCase(), "plan-status"),
    node("span", model.provider.toUpperCase(), "info-eyebrow"),
  );
  item.append(top, node("h3", model.label), node("code", model.model));
  if (model.summary) item.append(node("p", model.summary, "muted"));
  const capabilities = [];
  const profile = model.profile?.capabilities ?? {};
  if (profile.contextWindowTokens)
    capabilities.push(`Kontext: ${profile.contextWindowTokens.toLocaleString()} Tokens`);
  if (profile.imageInput) capabilities.push("Bild + Text");
  if (profile.toolUse) capabilities.push("Tool-Nutzung");
  if (profile.streaming) capabilities.push("Streaming");
  if (profile.reasoningEfforts?.length)
    capabilities.push(`Reasoning: ${profile.reasoningEfforts.join(", ")}`);
  if (model.recommendedFor?.length)
    capabilities.push(`Geeignet für: ${model.recommendedFor.join(", ")}`);
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
      target.append(
        node(
          "p",
          "Kein Modell ist serverseitig verbunden. Provider-Schlüssel bleiben ausschließlich im Control Plane.",
          "empty-product-state",
        ),
      );
      return;
    }
    for (const model of config.models) target.append(modelCard(model));
  } catch (error) {
    target.replaceChildren(
      node("p", `Modelle konnten nicht geladen werden: ${error.message}`, "empty-product-state"),
    );
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
  try {
    config = await request("/api/config");
  } catch {}
  target.replaceChildren(
    statusCard(
      "Mission Runtime",
      "LIVE",
      "Plan, Zustände, Budgets, Pause, Fortsetzen, Stoppen und wiederaufnehmbare Missionen.",
    ),
    statusCard(
      "Model Control",
      config?.models?.length ? "LIVE" : "NICHT VERBUNDEN",
      config?.models?.length
        ? `${config.models.length} Modellroute(n) sind serverseitig verbunden.`
        : "Keine Provider-Credentials sind in diesem Deployment aktiv.",
    ),
    statusCard(
      "Coding Workspace",
      config?.workspace?.writable ? "LIVE" : "BEGRENZT",
      "Dateiänderungen, Diffs und isolierte HTML-Vorschau mit serverseitiger Workspace-Grenze.",
    ),
    statusCard(
      "Verification",
      "LIVE",
      "Qualitätsgates, Review und Evidenz bleiben vom Modelloutput getrennt.",
    ),
    statusCard(
      "Research",
      config?.research ? "LIVE" : "NICHT VERBUNDEN",
      config?.research
        ? `Aktiver Adapter: ${config.research}.`
        : "Kein Research-Adapter verbunden.",
    ),
    statusCard(
      "Auth + RLS",
      config?.user ? "LIVE" : "ANMELDUNG ERFORDERLICH",
      "Neon Auth, serverseitige Sessions, nutzergebundener Postgres-Kontext und Row-Level Security.",
    ),
    statusCard(
      "Skills + Memory + Tool OS",
      "CORE",
      "Die verifizierten Odin-Kernmodule bleiben unter Runtime-Autorität. Diese Preview zeigt ihren Status, ohne Client oder Modell zusätzliche Berechtigungen zu geben.",
    ),
  );
}

byId("models-view")?.addEventListener("click", () => void openModels());
byId("system-view")?.addEventListener("click", () => void openSystem());
