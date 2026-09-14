const css = document.createElement("link");
css.rel = "stylesheet";
css.href = "/live-work.css";
document.head.append(css);

const conversation = document.querySelector(".conversation");
const composer = document.querySelector(".composer-wrap");
const panel = document.createElement("details");
panel.id = "odin-live-work";
panel.className = "odin-live-work";
panel.hidden = true;
panel.open = true;
panel.innerHTML = `<summary><span class="live-pulse" aria-hidden="true"></span><span class="live-title"><strong id="live-work-title">Odin is working</strong><small id="live-work-current">Preparing the next step</small></span><span id="live-work-badge" class="live-badge">LIVE</span></summary><div class="live-work-body"><ol id="live-work-plan" class="live-work-plan"></ol><div id="live-work-tools" class="live-work-tools"></div><div class="live-work-signals"><article><span>FOCUS</span><strong id="live-focus">Waiting for context</strong><small id="live-focus-detail">Only evidence selected by the runtime appears here.</small></article><article><span>OUTPUT</span><strong id="live-output">No changes yet</strong><small id="live-output-detail">Artifacts and file changes will appear as they happen.</small></article></div><div id="live-approval" class="live-approval" hidden><div><span>APPROVAL REQUIRED</span><strong id="live-approval-title">Odin needs your confirmation</strong><small id="live-approval-detail">Review the high-risk action before it runs.</small></div><button id="live-approval-open" type="button">Review & approve</button></div><p class="live-work-note">Visible work summaries come from Odin’s runtime events. Private chain-of-thought is never exposed.</p></div>`;
if (conversation && composer) conversation.insertBefore(panel, composer);

const byId = (id) => document.getElementById(id);
const state = { projectId: null, runId: null, tools: new Map(), steps: [], plan: [] };
const terminalStates = new Set(["COMPLETED", "CANCELLED", "BLOCKED", "FAILED"]);

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function shortJson(value) {
  try {
    const text = JSON.stringify(value);
    return text.length > 220 ? `${text.slice(0, 217)}…` : text;
  } catch {
    return "{}";
  }
}
function show() {
  panel.hidden = false;
}
function clear() {
  state.runId = null;
  state.tools.clear();
  state.steps = [];
  state.plan = [];
  panel.hidden = true;
  panel.dataset.state = "idle";
  byId("live-work-tools")?.replaceChildren();
  byId("live-work-plan")?.replaceChildren();
  if (byId("live-approval")) byId("live-approval").hidden = true;
}
function labelForState(value) {
  return (
    {
      UNDERSTANDING: "Understanding the goal",
      PLANNING: "Building the plan",
      WORKING: "Working through the task",
      VERIFYING: "Checking the result",
      REPAIRING: "Repairing a failed check",
      BLOCKED: "Waiting for your input",
      SUCCESS: "Work complete",
    }[value] ?? "Odin is working"
  );
}
function addStep(label, status = "active", meta = "") {
  if (!label) return;
  const duplicate = state.steps.at(-1);
  if (duplicate?.label === label && duplicate?.status === status) return;
  state.steps.push({
    label: String(label).slice(0, 180),
    status,
    meta: String(meta).slice(0, 180),
  });
  if (state.steps.length > 8) state.steps.shift();
  renderSteps();
}
function renderSteps() {
  const target = byId("live-work-plan");
  if (!target) return;
  target.replaceChildren();
  const canonical = state.plan.length ? state.plan : state.steps;
  for (const step of canonical.slice(-8)) {
    const item = document.createElement("li");
    item.className = `live-step ${step.status ?? "pending"}`;
    const marker = document.createElement("span");
    marker.className = "live-step-marker";
    marker.textContent = step.status === "done" ? "✓" : step.status === "failed" ? "!" : "";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = step.title ?? step.label ?? "Working";
    copy.append(title);
    if (step.meta) {
      const detail = document.createElement("small");
      detail.textContent = step.meta;
      copy.append(detail);
    }
    item.append(marker, copy);
    target.append(item);
  }
}
function toolCard(event) {
  const data = safeObject(event.data);
  const id = String(data.toolId ?? `${data.name}-${event.cursor}`);
  const card = document.createElement("article");
  card.className = "live-tool active";
  card.dataset.toolId = id;
  const header = document.createElement("div");
  const tag = document.createElement("span");
  tag.textContent = "TOOL";
  const name = document.createElement("strong");
  name.textContent = String(data.name ?? "connected tool");
  header.append(tag, name);
  const args = document.createElement("code");
  args.textContent = shortJson(safeObject(data.input));
  const status = document.createElement("small");
  status.textContent = "Running…";
  card.append(header, args, status);
  byId("live-work-tools")?.prepend(card);
  while ((byId("live-work-tools")?.children.length ?? 0) > 4)
    byId("live-work-tools")?.lastElementChild?.remove();
  state.tools.set(id, card);
}
function finishTool(event) {
  const data = safeObject(event.data);
  const id = String(data.toolId ?? "");
  let card = id ? state.tools.get(id) : null;
  if (!card) card = [...state.tools.values()].find((node) => node.classList.contains("active"));
  if (!card) return;
  card.classList.remove("active");
  const failed = data.status === "failed";
  card.classList.toggle("failed", failed);
  card.classList.toggle("done", !failed);
  const status = card.querySelector("small");
  if (status)
    status.textContent = failed
      ? String(data.message ?? "Stopped")
      : Object.keys(safeObject(data.summary)).length
        ? `Done · ${shortJson(data.summary)}`
        : "Done";
}
function flashChange(path) {
  panel.classList.remove("changed");
  requestAnimationFrame(() => panel.classList.add("changed"));
  setTimeout(() => panel.classList.remove("changed"), 900);
  const buttons = [...document.querySelectorAll(".file-button")];
  const target = buttons.find((button) => button.textContent === path);
  if (target) {
    target.classList.add("odin-file-flash");
    setTimeout(() => target.classList.remove("odin-file-flash"), 1200);
  }
}
function handle(event) {
  if (!event || typeof event !== "object") return;
  const data = safeObject(event.data);
  state.runId = event.turnId ?? state.runId;
  show();
  if (event.type === "state") {
    const companion = String(data.companionState ?? data.state ?? "WORKING");
    const runtimeState = String(data.state ?? "");
    panel.dataset.state = terminalStates.has(runtimeState) ? "done" : companion.toLowerCase();
    byId("live-work-title").textContent = labelForState(companion);
    byId("live-work-current").textContent = String(
      data.objective ?? data.status ?? companion,
    ).slice(0, 180);
    byId("live-work-badge").textContent = terminalStates.has(runtimeState) ? runtimeState : "LIVE";
    if (Array.isArray(data.plan) && data.plan.length) {
      state.plan = data.plan.map((step) => ({ ...step }));
      renderSteps();
    }
    return;
  }
  if (event.type === "plan") {
    state.plan = Array.isArray(data.steps) ? data.steps.map((step) => ({ ...step })) : [];
    byId("live-work-current").textContent = "Plan updated from the canonical runtime";
    renderSteps();
    return;
  }
  if (event.type === "activity") {
    const label = String(data.message ?? "Runtime activity");
    byId("live-work-current").textContent = label;
    addStep(label, data.phase === "repair" ? "active" : "done", String(data.phase ?? ""));
    return;
  }
  if (event.type === "model.start") {
    const label = data.role === "reviewer" ? "Independent review started" : "Model is working";
    byId("live-work-current").textContent =
      `${label} · ${String(data.effort ?? "provider default")}`;
    addStep(label, "active", `call ${String(data.call ?? "")} · ${String(data.effort ?? "")}`);
    return;
  }
  if (event.type === "tool.start") {
    byId("live-work-current").textContent = `Using ${String(data.name ?? "a connected tool")}`;
    toolCard(event);
    addStep(
      `Tool · ${String(data.name ?? "connected tool")}`,
      "active",
      shortJson(data.input ?? {}),
    );
    return;
  }
  if (event.type === "tool.end") {
    finishTool(event);
    addStep(
      `Tool · ${String(data.name ?? "connected tool")}`,
      data.status === "failed" ? "failed" : "done",
      data.status === "failed" ? String(data.message ?? "failed") : shortJson(data.summary ?? {}),
    );
    return;
  }
  if (event.type === "file.changed") {
    const path = String(data.path ?? "workspace file");
    byId("live-output").textContent = `Changed ${path}`;
    byId("live-output-detail").textContent =
      "The actual workspace changed; open Files or Preview to inspect it.";
    addStep(`Changed ${path}`, "done", "workspace evidence");
    flashChange(path);
    return;
  }
  if (event.type === "quality") {
    const passed = data.passed === true;
    byId("live-work-current").textContent =
      `${String(data.commandId ?? "Quality check")} ${passed ? "passed" : "failed"}`;
    addStep(
      `Check · ${String(data.commandId ?? "quality")}`,
      passed ? "done" : "failed",
      passed ? "passed" : "repair required",
    );
    return;
  }
  if (event.type === "verification") {
    const passed = data.outcome === "PASS";
    addStep("Verification", passed ? "done" : "failed", String(data.scope ?? "runtime evidence"));
    if (passed) {
      byId("live-output").textContent = "Verified result ready";
      byId("live-output-detail").textContent =
        "The runtime has attached passing evidence to this run.";
    }
    return;
  }
  if (event.type === "memory.brain.pulse") {
    const memories = Array.isArray(data.selectedMemoryIds) ? data.selectedMemoryIds.length : 0;
    const workspace = Array.isArray(data.selectedWorkspaceReferences)
      ? data.selectedWorkspaceReferences.length
      : 0;
    byId("live-focus").textContent = `${memories + workspace} useful context references selected`;
    byId("live-focus-detail").textContent =
      `${memories} Memory · ${workspace} Workspace. Stale/noise candidates stay outside ordinary context.`;
    return;
  }
  if (event.type === "source") {
    addStep(
      `Source · ${String(data.title ?? data.id ?? "evidence")}`,
      "done",
      "retrieved evidence",
    );
    return;
  }
  if (event.type.includes("approval")) {
    const approval = byId("live-approval");
    approval.hidden = false;
    byId("live-approval-title").textContent = String(data.action ?? "Odin needs your confirmation");
    byId("live-approval-detail").textContent =
      `Risk ${String(data.risk ?? "runtime-defined")} · external action paused`;
    byId("live-work-current").textContent = "Waiting for your approval";
    panel.open = true;
    return;
  }
  if (event.type === "answer") {
    byId("live-work-current").textContent = "Result delivered";
    byId("live-work-badge").textContent = "DONE";
    panel.dataset.state = "done";
  }
}

window.addEventListener("odin:runtime-event", (event) => handle(event.detail));
window.addEventListener("odin:runtime-reset", clear);
window.addEventListener("odin:project-changed", (event) => {
  state.projectId = event.detail?.projectId ?? null;
  clear();
});
byId("live-approval-open")?.addEventListener("click", () => {
  const projectId = state.projectId ?? new URLSearchParams(location.search).get("project");
  const runId = state.runId;
  if (!projectId || !runId) return;
  location.assign(
    `/browser?project=${encodeURIComponent(projectId)}&run=${encodeURIComponent(runId)}`,
  );
});
