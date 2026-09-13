const m4css = document.createElement("link");
m4css.rel = "stylesheet";
m4css.href = "/product-m4.css";
document.head.append(m4css);

const m4el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

async function m4request(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "X-Odin-Request": "1",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    // A stable public error is produced below.
  }
  if (!response.ok) {
    const error = new Error(data.message ?? "Run Center request failed.");
    error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return data;
}

const m4main = document.querySelector(".main");
const m4surface = document.createElement("section");
m4surface.id = "run-center-panel";
m4surface.className = "m4-run-center";
m4surface.hidden = true;
m4surface.innerHTML = `
  <header class="m4-hero">
    <div><span class="m4-eyebrow">RUN CENTER</span><h1>See the work, not hidden reasoning.</h1><p>Plans, dependencies, tools, checks, repairs, context and controls are projected from Odin's canonical runtime evidence.</p></div>
    <div id="m4-live" class="m4-live" data-state="idle"><span></span><div><strong>Runtime</strong><small>Open a Run</small></div></div>
  </header>
  <div id="m4-status" class="m4-status" hidden role="status"></div>
  <div class="m4-layout">
    <aside class="m4-runs" aria-label="Project runs">
      <div class="m4-panel-title"><span>RUN HISTORY</span><span id="m4-run-count">0</span></div>
      <div id="m4-run-list"></div>
    </aside>
    <main class="m4-detail">
      <div id="m4-empty" class="m4-empty"><span>◇</span><h2>No Run selected</h2><p>Start a goal in this Project or choose a previous Run.</p></div>
      <div id="m4-run" hidden>
        <section class="m4-run-head">
          <div><span id="m4-run-state" class="m4-state">—</span><h2 id="m4-goal">Run</h2><p id="m4-meta"></p></div>
          <div id="m4-controls" class="m4-controls"></div>
        </section>
        <section class="m4-metrics" id="m4-metrics"></section>
        <section class="m4-section"><div class="m4-section-title"><span>TASK DAG</span><span id="m4-task-summary"></span></div><div id="m4-dag" class="m4-dag"></div></section>
        <div class="m4-two-col">
          <section class="m4-section"><div class="m4-section-title"><span>LIVE ACTIVITY</span><span id="m4-activity-count"></span></div><div id="m4-activity" class="m4-timeline"></div></section>
          <section class="m4-section"><div class="m4-section-title"><span>VERIFICATION</span><span id="m4-verification-state"></span></div><div id="m4-verification" class="m4-evidence"></div></section>
        </div>
        <div class="m4-two-col">
          <section class="m4-section"><div class="m4-section-title"><span>CONTEXT + OUTPUTS</span></div><div id="m4-context" class="m4-evidence"></div></section>
          <section class="m4-section"><div class="m4-section-title"><span>RECOVERY + APPROVALS</span></div><div id="m4-governance" class="m4-evidence"></div></section>
        </div>
      </div>
    </main>
  </div>`;
m4main?.append(m4surface);

const m4$ = (id) => document.getElementById(id);
const m4Terminal = new Set(["COMPLETED", "CANCELLED", "BLOCKED", "FAILED"]);
const m4State = {
  projectId: null,
  project: null,
  events: [],
  workspace: null,
  config: null,
  selectedRunId: null,
  stream: null,
  refreshTimer: null,
};

function m4ProjectFromUrl() {
  return new URLSearchParams(window.location.search).get("project");
}

function m4SetStatus(text, state = "") {
  const node = m4$("m4-status");
  node.textContent = text;
  node.dataset.state = state;
  node.hidden = !text;
}

function m4HideOtherSurfaces() {
  for (const id of [
    "chat-layout",
    "projects-panel",
    "knowledge-panel",
    "skills-panel",
    "activity-page",
    "models-panel",
    "system-panel",
    "benchmarks",
    "workspace-os-panel",
  ]) {
    const node = document.getElementById(id);
    if (node) node.hidden = true;
  }
}

function m4Show() {
  if (!m4State.projectId) return;
  m4HideOtherSurfaces();
  m4surface.hidden = false;
  m4$("project-nav").hidden = false;
  m4$("page-title").textContent = "Run Center";
  for (const button of document.querySelectorAll("[data-project-section]"))
    button.classList.toggle("selected", button.dataset.projectSection === "runs");
}

function m4Hide() {
  m4surface.hidden = true;
}

function m4RunEvents(runId) {
  return m4State.events.filter((event) => event.turnId === runId);
}

function m4FormatTime(value) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unknown" : parsed.toLocaleString();
}

function m4ReadableActivity(event) {
  const data = event.data ?? {};
  if (event.type === "tool.start") return `Using ${String(data.name ?? "a connected tool")}`;
  if (event.type === "tool.end")
    return data.status === "failed"
      ? String(data.message ?? "Tool failed")
      : "Tool activity finished";
  if (event.type === "quality")
    return `Quality ${data.passed === true ? "passed" : "failed"}: ${String(data.commandId ?? "configured check")}`;
  if (event.type === "verification")
    return data.outcome === "PASS" ? "Verification passed" : "Verification requires repair";
  if (event.type === "file.changed")
    return `Updated ${String(data.path ?? "a workspace file")}`;
  if (event.type === "model.start")
    return data.role === "reviewer" ? "Independent review started" : "Model work started";
  if (event.type === "state")
    return `Runtime state · ${String(data.state ?? data.companionState ?? "updated")}`;
  if (event.type === "review") return "Independent review evidence received";
  if (event.type === "memory.brain.pulse") return "Selected context compiled";
  if (event.type === "error") return String(data.message ?? "Run error");
  if (event.type === "activity") return String(data.message ?? "Runtime activity");
  if (event.type === "answer") return "Result delivered";
  if (event.type === "steering") return "Steering instruction accepted";
  return null;
}

function m4EventTone(event) {
  const data = event.data ?? {};
  if (event.type === "error" || (event.type === "tool.end" && data.status === "failed"))
    return "failed";
  if (event.type === "quality" && data.passed !== true) return "failed";
  if (event.type === "verification" && data.outcome !== "PASS") return "failed";
  if (event.type === "quality" || event.type === "verification") return "passed";
  return "neutral";
}

function m4RenderRuns() {
  const list = m4$("m4-run-list");
  list.replaceChildren();
  const runs = m4State.project?.turns ?? [];
  m4$("m4-run-count").textContent = String(runs.length);
  for (const run of [...runs].reverse()) {
    const button = m4el("button", undefined, "m4-run-row");
    button.type = "button";
    button.dataset.selected = String(run.id === m4State.selectedRunId);
    button.append(
      m4el(
        "span",
        run.state,
        `m4-run-dot state-${String(run.companionState ?? "IDLE").toLowerCase()}`,
      ),
      m4el("strong", run.objective),
      m4el("small", `${run.mode} · ${m4FormatTime(run.createdAt)}`),
    );
    button.onclick = () => {
      m4State.selectedRunId = run.id;
      m4RenderRuns();
      m4RenderSelected();
    };
    list.append(button);
  }
  if (!runs.length) list.append(m4el("p", "No Runs yet.", "m4-muted"));
}

function m4Metric(label, value, detail) {
  const card = m4el("article", undefined, "m4-metric");
  card.append(m4el("span", label), m4el("strong", value), m4el("small", detail));
  return card;
}

function m4RenderControls(run) {
  const target = m4$("m4-controls");
  target.replaceChildren();
  if (m4Terminal.has(run.state)) {
    target.append(m4el("span", "Run is terminal", "m4-muted"));
    return;
  }
  if (run.state === "PAUSED") target.append(m4Control("Resume", "resume", run));
  else target.append(m4Control("Pause", "pause", run));
  target.append(m4Control("Cancel", "cancel", run, "danger"));
  const replan = m4el("button", "Request replan", "m4-secondary");
  replan.type = "button";
  replan.onclick = async () => {
    replan.disabled = true;
    try {
      await m4request(`/api/turns/${encodeURIComponent(run.id)}/steer`, {
        text: "Re-evaluate the current plan against the goal and current evidence. Replan only where the canonical runtime determines a change is needed.",
      });
      m4SetStatus("Replan request accepted as a steering instruction.");
      await m4Reload();
    } catch (error) {
      m4SetStatus(error.message, "error");
    } finally {
      replan.disabled = false;
    }
  };
  target.append(replan);
}

function m4Control(label, command, run, className = "") {
  const button = m4el("button", label, className);
  button.type = "button";
  button.onclick = async () => {
    button.disabled = true;
    try {
      const current = await m4request(`/api/turns/${encodeURIComponent(run.id)}`);
      await m4request(`/api/turns/${encodeURIComponent(run.id)}/control`, {
        command,
        expectedVersion: current.version,
      });
      m4SetStatus(`${label} accepted by the server-authoritative runtime.`);
      await m4Reload();
    } catch (error) {
      m4SetStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  };
  return button;
}

function m4RenderDag(run) {
  const target = m4$("m4-dag");
  target.replaceChildren();
  const plan = run.plan ?? [];
  const done = plan.filter((step) => step.status === "done").length;
  m4$("m4-task-summary").textContent = `${done}/${plan.length} verified`;
  for (const step of plan) {
    const card = m4el("article", undefined, `m4-task status-${step.status}`);
    const dependencies = step.dependsOn ?? [];
    const dependency = dependencies.length
      ? `Depends on ${dependencies.join(", ")}`
      : "No dependencies";
    card.append(
      m4el("span", step.status.toUpperCase(), "m4-task-state"),
      m4el("h3", step.title),
      m4el("p", dependency, "m4-dependency"),
    );
    if (step.definitionOfDone?.length) {
      const list = m4el("ul", undefined, "m4-dod");
      for (const item of step.definitionOfDone) list.append(m4el("li", item));
      card.append(list);
    }
    target.append(card);
  }
  if (!plan.length)
    target.append(m4el("p", "The runtime has not published a task plan.", "m4-muted"));
}

function m4RenderActivity(run) {
  const target = m4$("m4-activity");
  target.replaceChildren();
  const visible = m4RunEvents(run.id)
    .map((event) => ({ event, label: m4ReadableActivity(event) }))
    .filter((item) => item.label);
  m4$("m4-activity-count").textContent = `${visible.length} events`;
  for (const { event, label } of visible.slice(-80).reverse()) {
    const row = m4el("article", undefined, `m4-event ${m4EventTone(event)}`);
    row.append(
      m4el("span", event.type),
      m4el("strong", label),
      m4el("time", m4FormatTime(event.createdAt)),
    );
    target.append(row);
  }
  if (!visible.length) target.append(m4el("p", "No visible runtime activity yet.", "m4-muted"));
}

function m4RenderVerification(run) {
  const target = m4$("m4-verification");
  target.replaceChildren();
  const events = m4RunEvents(run.id);
  const evidence = events.filter((event) =>
    ["quality", "verification", "review"].includes(event.type),
  );
  const failed = evidence.some((event) => m4EventTone(event) === "failed");
  const passed = evidence.some((event) => m4EventTone(event) === "passed");
  m4$("m4-verification-state").textContent = failed
    ? "needs repair"
    : passed
      ? "evidence present"
      : "pending";
  for (const event of evidence.slice().reverse()) {
    const data = event.data ?? {};
    const card = m4el("article", undefined, `m4-evidence-card ${m4EventTone(event)}`);
    let title = "Independent review";
    let detail = String(data.text ?? "Review evidence recorded.");
    if (event.type === "quality") {
      title = `${data.passed === true ? "Passed" : "Failed"} · ${String(data.commandId ?? "quality check")}`;
      detail = "Repository quality evidence emitted by the runtime.";
    } else if (event.type === "verification") {
      title = `${String(data.outcome ?? "PENDING")} · ${String(data.scope ?? "verification")}`;
      detail =
        Array.isArray(data.failures) && data.failures.length
          ? data.failures.join(" · ")
          : "No failure details reported.";
    }
    card.append(
      m4el("strong", title),
      m4el("p", detail),
      m4el("small", m4FormatTime(event.createdAt)),
    );
    target.append(card);
  }
  if (!evidence.length)
    target.append(
      m4el(
        "p",
        "Required evidence has not been published yet. Odin must not treat missing evidence as a pass.",
        "m4-muted",
      ),
    );
}

function m4RenderContext(run) {
  const target = m4$("m4-context");
  target.replaceChildren();
  const events = m4RunEvents(run.id);
  const pulse = [...events].reverse().find((event) => event.type === "memory.brain.pulse");
  if (pulse) {
    const memory = pulse.data?.selectedMemoryIds ?? [];
    const workspace = pulse.data?.selectedWorkspaceReferences ?? [];
    target.append(
      m4Evidence(
        "Selected context",
        `${memory.length} Memory · ${workspace.length} Workspace`,
        `Compiler result ${String(pulse.data?.contextResultHash ?? "unknown").slice(0, 12)}`,
      ),
    );
  } else {
    target.append(m4el("p", "No Brain Pulse evidence is attached to this Run.", "m4-muted"));
  }
  const outputs = (m4State.workspace?.items ?? []).filter((item) => item.sourceRunId === run.id);
  for (const item of outputs)
    target.append(m4Evidence("Artifact", item.title, `${item.kind} · v${item.version}`));
  const changed = new Set(
    events
      .filter((event) => event.type === "file.changed")
      .map((event) => String(event.data?.path ?? "")),
  );
  if (changed.size)
    target.append(
      m4Evidence(
        "Workspace changes",
        `${changed.size} file${changed.size === 1 ? "" : "s"}`,
        [...changed].slice(0, 5).join(" · "),
      ),
    );
}

function m4Evidence(label, title, detail) {
  const card = m4el("article", undefined, "m4-evidence-card");
  card.append(m4el("span", label), m4el("strong", title), m4el("small", detail));
  return card;
}

function m4RenderGovernance(run) {
  const target = m4$("m4-governance");
  target.replaceChildren();
  const events = m4RunEvents(run.id);
  const recovery = events.filter(
    (event) =>
      (event.type === "state" && event.data?.state === "CHECKPOINTING") ||
      (event.type === "activity" && event.data?.phase === "recovery"),
  );
  const repairs = events.filter(
    (event) =>
      (event.type === "state" &&
        ["DIAGNOSING", "REPAIRING"].includes(String(event.data?.state))) ||
      (event.type === "verification" && event.data?.outcome !== "PASS") ||
      (event.type === "quality" && event.data?.passed !== true),
  );
  const approvals = events.filter((event) => event.type.includes("approval"));
  target.append(
    m4Evidence(
      "Repair cycles",
      String(repairs.length),
      repairs.length ? "Failure and repair evidence remains visible." : "No repair cycle recorded.",
    ),
    m4Evidence(
      "Checkpoint / recovery",
      String(recovery.length),
      recovery.length
        ? "Recovery/checkpoint evidence recorded."
        : "No checkpoint/recovery event exposed for this Run.",
    ),
  );
  if (approvals.length) {
    for (const event of approvals)
      target.append(
        m4Evidence(
          "Approval",
          String(event.data?.action ?? event.type),
          `Risk ${String(event.data?.risk ?? "runtime-defined")}`,
        ),
      );
  } else {
    target.append(
      m4Evidence(
        "Approvals",
        "None requested",
        "No approval event is attached to this Run; the client does not fabricate one.",
      ),
    );
  }
}

function m4RenderSelected() {
  const run = (m4State.project?.turns ?? []).find(
    (candidate) => candidate.id === m4State.selectedRunId,
  );
  m4$("m4-empty").hidden = Boolean(run);
  m4$("m4-run").hidden = !run;
  if (!run) return;
  const events = m4RunEvents(run.id);
  m4$("m4-run-state").textContent = run.state;
  m4$("m4-run-state").dataset.state = run.companionState ?? "IDLE";
  m4$("m4-goal").textContent = run.objective;
  m4$("m4-meta").textContent = `${run.mode} · ${run.modelId} · ${m4FormatTime(run.createdAt)}`;
  m4$("m4-live").dataset.state = m4Terminal.has(run.state) ? "done" : "active";
  m4$("m4-live").querySelector("small").textContent =
    `${run.companionState ?? run.state} · ${events.length} recorded events`;
  const calls = events.filter((event) => event.type === "model.start");
  const maxCalls = calls.reduce(
    (max, event) => Math.max(max, Number(event.data?.maxCalls ?? 0)),
    0,
  );
  const toolCalls = events.filter((event) => event.type === "tool.start").length;
  const usage = run.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const repairStates = events.filter(
    (event) =>
      event.type === "state" && ["DIAGNOSING", "REPAIRING"].includes(String(event.data?.state)),
  ).length;
  const metrics = m4$("m4-metrics");
  metrics.replaceChildren(
    m4Metric(
      "Tokens",
      Number(usage.totalTokens ?? 0).toLocaleString(),
      `${Number(usage.inputTokens ?? 0).toLocaleString()} in · ${Number(usage.outputTokens ?? 0).toLocaleString()} out`,
    ),
    m4Metric(
      "Model calls",
      String(calls.length),
      maxCalls ? `${maxCalls} call ceiling observed` : "No call ceiling observed yet",
    ),
    m4Metric(
      "Tool activity",
      String(toolCalls),
      `${m4State.config?.limits?.maxToolCalls ?? "—"} configured ceiling`,
    ),
    m4Metric(
      "Repair states",
      String(repairStates),
      "Derived only from canonical state events",
    ),
  );
  m4RenderControls(run);
  m4RenderDag(run);
  m4RenderActivity(run);
  m4RenderVerification(run);
  m4RenderContext(run);
  m4RenderGovernance(run);
}

async function m4Load(projectId, { show = true } = {}) {
  if (!projectId) return;
  m4SetStatus("Loading canonical Run evidence…");
  try {
    const [project, eventData, workspace, config] = await Promise.all([
      m4request(`/api/projects/${encodeURIComponent(projectId)}`),
      m4request(`/api/projects/${encodeURIComponent(projectId)}/events?after=0`),
      m4request(`/api/workspace/projects/${encodeURIComponent(projectId)}`).catch(() => null),
      m4request("/api/config").catch(() => null),
    ]);
    if (m4ProjectFromUrl() !== projectId) return;
    m4State.projectId = projectId;
    m4State.project = project;
    m4State.events = eventData.events ?? [];
    m4State.workspace = workspace;
    m4State.config = config;
    const runs = project.turns ?? [];
    if (!runs.some((run) => run.id === m4State.selectedRunId))
      m4State.selectedRunId = runs.at(-1)?.id ?? null;
    m4RenderRuns();
    m4RenderSelected();
    m4SetStatus("");
    if (show) m4Show();
  } catch (error) {
    m4SetStatus(error.message, "error");
  }
}

async function m4Reload() {
  if (!m4State.projectId) return;
  await m4Load(m4State.projectId, { show: !m4surface.hidden });
}

function m4Watch(projectId) {
  m4State.stream?.close();
  if (!projectId || typeof EventSource !== "function") return;
  const stream = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/events?after=0`);
  m4State.stream = stream;
  stream.onmessage = () => {
    clearTimeout(m4State.refreshTimer);
    m4State.refreshTimer = setTimeout(() => void m4Reload(), 180);
  };
  stream.onerror = () => {
    m4$("m4-live").dataset.state = "reconnecting";
    m4$("m4-live").querySelector("small").textContent = "Reconnecting to runtime evidence";
  };
}

const m4RunsButton = document.querySelector('[data-project-section="runs"]');
m4RunsButton?.addEventListener("click", () => {
  const projectId = m4ProjectFromUrl();
  if (!projectId) return;
  m4State.projectId = projectId;
  m4Show();
  void m4Load(projectId);
  m4Watch(projectId);
});

for (const button of document.querySelectorAll(
  '[data-project-section]:not([data-project-section="runs"])',
))
  button.addEventListener("click", m4Hide);
for (const button of document.querySelectorAll(
  "#home-view,#projects-view,#knowledge-view,#skills-view,#activity-view,#models-view,#system-view,#benchmark-view",
))
  button.addEventListener("click", m4Hide);

window.addEventListener("popstate", () => {
  const projectId = m4ProjectFromUrl();
  if (projectId !== m4State.projectId) {
    m4State.stream?.close();
    m4State.projectId = projectId;
    m4Hide();
  }
});
