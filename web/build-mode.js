const m6css = document.createElement("link");
m6css.rel = "stylesheet";
m6css.href = "/product-m6.css";
document.head.append(m6css);

const m6$ = (id) => document.getElementById(id);
const m6el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

const homeButton = m6$("home-view");
const buildNav = m6el("button", undefined, "nav-item");
buildNav.id = "build-view";
buildNav.type = "button";
buildNav.innerHTML = '<span class="nav-icon">▣</span>Build';
homeButton?.after(buildNav);

const homeAction = m6el("button");
homeAction.id = "m6-home-build";
homeAction.type = "button";
homeAction.innerHTML = "<span>BUILD MODE</span>Build something";
document.querySelector(".suggestions")?.prepend(homeAction);

const panel = m6el("section", undefined, "workspace-surface m6-build");
panel.id = "build-panel";
panel.hidden = true;
panel.innerHTML = `
  <header class="m6-hero">
    <div><span class="welcome-tag">BUILD MODE</span><h1>From goal to a working product.</h1><p>Spec, blueprint, real files, verification and a revision-bound Preview stay inside the same Project.</p></div>
    <span class="m6-preview-badge">Preview ≠ Production</span>
  </header>
  <div id="m6-status" class="m6-status" role="status">Choose a goal to start.</div>
  <div class="m6-layout">
    <section class="m6-control">
      <form id="m6-start-form" class="m6-card">
        <span class="m6-eyebrow">01 · GOAL</span>
        <label>What should Odin build?<textarea id="m6-goal" rows="5" maxlength="2000" required placeholder="Build a simple student exam planner."></textarea></label>
        <label>Target<select id="m6-target"><option value="greenfield">New application</option><option value="existing">Existing connected application</option></select></label>
        <p id="m6-target-note" class="m6-muted">Greenfield uses Odin's isolated Project workspace and the maintained static-web stack.</p>
        <button class="m6-primary" type="submit">Start Build</button>
      </form>
      <section id="m6-progress-card" class="m6-card" hidden>
        <span class="m6-eyebrow">02 · BUILD STATE</span>
        <div class="m6-stage"><strong id="m6-stage">—</strong><span id="m6-run-state">No Run yet</span></div>
        <div id="m6-documents" class="m6-documents"></div>
        <p class="m6-muted">Progress comes from the canonical Run and verification state. Build Mode does not mint progress.</p>
      </section>
      <form id="m6-iterate-form" class="m6-card" hidden>
        <span class="m6-eyebrow">03 · ITERATE</span>
        <label>Change request<textarea id="m6-instruction" rows="3" maxlength="2000" placeholder="Add dark mode."></textarea></label>
        <div><span class="m6-label">Visual target</span><div id="m6-targets" class="m6-targets"><span class="m6-muted">No verified source mapping selected.</span></div></div>
        <label class="m6-check"><input id="m6-remember" type="checkbox" /> Remember this as a durable Project decision</label>
        <button class="m6-primary" type="submit">Apply scoped change</button>
      </form>
    </section>
    <section class="m6-preview-card">
      <div class="m6-preview-head"><div><span class="m6-eyebrow">PREVIEW</span><strong id="m6-revision">No verified revision</strong></div><div class="m6-viewports" role="group" aria-label="Preview viewport"><button type="button" data-m6-viewport="desktop" class="selected">Desktop</button><button type="button" data-m6-viewport="tablet">Tablet</button><button type="button" data-m6-viewport="mobile">Mobile</button></div></div>
      <div id="m6-preview-empty" class="m6-preview-empty"><span>◇</span><h2>Preview appears after verified files exist.</h2><p>No deployment is implied.</p></div>
      <iframe id="m6-preview" title="Build Preview" sandbox="allow-scripts" referrerpolicy="no-referrer" hidden></iframe>
    </section>
  </div>`;
document.querySelector("main.main")?.append(panel);

let m6State = { projectId: null, summary: null, turn: null, targetRef: null, poll: null };

async function m6request(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "X-Odin-Request": "1",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? "Build request failed.");
  return data;
}

function currentProject() {
  return new URLSearchParams(window.location.search).get("project");
}

function hideProductSurfaces() {
  for (const selector of [
    "#chat-layout",
    "#projects-panel",
    "#knowledge-panel",
    "#skills-panel",
    "#activity-page",
    "#models-panel",
    "#system-panel",
    "#benchmarks",
  ]) {
    const node = document.querySelector(selector);
    if (node) node.hidden = true;
  }
  for (const item of document.querySelectorAll(".sidebar .nav-item")) item.classList.remove("selected");
  buildNav.classList.add("selected");
  m6$("page-title").textContent = "Build";
}

async function openBuild() {
  hideProductSurfaces();
  panel.hidden = false;
  const projectId = currentProject();
  m6State.projectId = projectId;
  m6$("m6-target").value = projectId ? "existing" : "greenfield";
  m6UpdateTargetNote();
  if (projectId) await m6Load(projectId);
  else m6RenderEmpty();
}

function m6UpdateTargetNote() {
  const existing = m6$("m6-target").value === "existing";
  m6$("m6-target-note").textContent = existing
    ? currentProject()
      ? "Existing-app mode inspects the connected repository and applies a scoped delta."
      : "Open a Project with a connected repository before using existing-app mode."
    : "Greenfield uses Odin's isolated Project workspace and the maintained static-web stack.";
}

function m6RenderEmpty() {
  m6State.summary = null;
  m6State.turn = null;
  m6$("m6-progress-card").hidden = true;
  m6$("m6-iterate-form").hidden = true;
  m6$("m6-preview").hidden = true;
  m6$("m6-preview-empty").hidden = false;
  m6$("m6-status").textContent = "Choose a goal to start.";
}

async function m6Load(projectId) {
  try {
    const summary = await m6request(`/api/build/projects/${encodeURIComponent(projectId)}`);
    m6State.summary = summary;
    if (!summary.active) {
      m6RenderEmpty();
      m6State.projectId = projectId;
      return;
    }
    m6State.projectId = projectId;
    m6State.turn = summary.latestRunId
      ? await m6request(`/api/turns/${encodeURIComponent(summary.latestRunId)}`)
      : null;
    await m6Render();
  } catch (error) {
    m6$("m6-status").textContent = error.message;
    m6$("m6-status").dataset.state = "error";
  }
}

function stageFor(state, hasPreview) {
  if (!state) return "Designing";
  if (state === "COMPLETED") return hasPreview ? "Preview Ready" : "Testing";
  if (["FAILED", "BLOCKED"].includes(state)) return "Repairing";
  if (["OBSERVING", "VERIFYING", "CHECKPOINTING", "FINAL_AUDIT"].includes(state)) return "Testing";
  if (state === "EXECUTING") return "Building";
  if (["RETRIEVING", "PLANNING", "RISK_CHECK"].includes(state)) return "Specifying";
  return "Understanding";
}

async function m6Render() {
  const summary = m6State.summary;
  if (!summary?.active) return;
  const state = m6State.turn?.state ?? null;
  const ready = state === "COMPLETED" && Boolean(summary.preview);
  m6$("m6-progress-card").hidden = false;
  m6$("m6-iterate-form").hidden = false;
  m6$("m6-stage").textContent = stageFor(state, ready);
  m6$("m6-run-state").textContent = state ?? "Preparing canonical Run";
  m6$("m6-status").textContent = ready
    ? "Verified Build revision is ready to preview. Production deployment is still separate."
    : state === "FAILED" || state === "BLOCKED"
      ? "The canonical Run is blocked. Repair or send a scoped iteration; READY is not being fabricated."
      : "Build state is derived from the canonical Run.";
  const docs = m6$("m6-documents");
  docs.replaceChildren();
  for (const item of summary.documents ?? []) {
    const row = m6el("article", undefined, "m6-doc");
    row.append(m6el("strong", item.title), m6el("small", `v${item.version} · ${item.path}`));
    docs.append(row);
  }
  if (summary.preview) {
    m6$("m6-preview").hidden = false;
    m6$("m6-preview-empty").hidden = true;
    m6$("m6-revision").textContent = `Revision ${summary.preview.revision.slice(0, 12)}`;
    m6$("m6-preview").src = `/api/projects/${encodeURIComponent(summary.projectId)}/preview?file=${encodeURIComponent(summary.preview.file)}&revision=${encodeURIComponent(summary.preview.revision)}`;
  } else {
    m6$("m6-preview").hidden = true;
    m6$("m6-preview-empty").hidden = false;
    m6$("m6-revision").textContent = "No verified revision";
  }
  await m6LoadTargets();
}

async function m6LoadTargets() {
  const target = m6$("m6-targets");
  target.replaceChildren();
  m6State.targetRef = null;
  try {
    const result = await m6request(`/api/build/projects/${encodeURIComponent(m6State.projectId)}/targets`);
    if (!result.targets?.length) {
      target.append(m6el("span", "No reliable visual-source mapping. Use a normal Build instruction.", "m6-muted"));
      return;
    }
    for (const item of result.targets) {
      const button = m6el("button", item.label);
      button.type = "button";
      button.title = item.sourceRef;
      button.onclick = () => {
        m6State.targetRef = item.sourceRef;
        for (const other of target.querySelectorAll("button")) other.classList.toggle("selected", other === button);
      };
      target.append(button);
    }
  } catch (error) {
    target.append(m6el("span", error.message, "m6-muted"));
  }
}

async function submitBuildRun(runRequest) {
  const modelId = m6$("model")?.value;
  if (!modelId) throw new Error("Choose an available model before starting Build Mode.");
  const turn = await m6request(`/api/projects/${encodeURIComponent(m6State.projectId)}/turns`, {
    text: runRequest.text,
    mode: runRequest.mode,
    modelId,
    requestId: runRequest.requestId,
    attachments: [],
  });
  await m6request(
    `/api/build/projects/${encodeURIComponent(m6State.projectId)}/runs/${encodeURIComponent(turn.id)}`,
    { requestId: runRequest.requestId },
  );
  await m6request(`/api/turns/${encodeURIComponent(turn.id)}/run`, {});
  m6State.turn = turn;
  schedulePoll();
  await m6Load(m6State.projectId);
}

function schedulePoll() {
  if (m6State.poll) clearTimeout(m6State.poll);
  if (!m6State.turn || ["COMPLETED", "FAILED", "BLOCKED", "CANCELLED"].includes(m6State.turn.state)) return;
  m6State.poll = setTimeout(async () => {
    if (!m6State.projectId) return;
    await m6Load(m6State.projectId);
    schedulePoll();
  }, 1500);
}

m6$("m6-start-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const target = m6$("m6-target").value;
    const projectId = currentProject();
    if (target === "existing" && !projectId) throw new Error("Open an existing Project first.");
    const path = projectId ? `/api/build/projects/${encodeURIComponent(projectId)}` : "/api/build";
    const started = await m6request(path, {
      goal: m6$("m6-goal").value,
      target,
      stack: target === "existing" ? "existing" : "static-web",
    });
    m6State.projectId = started.projectId;
    m6State.summary = started;
    if (!projectId) {
      const next = new URL(window.location.href);
      next.searchParams.set("project", started.projectId);
      window.history.replaceState({}, "", next);
    }
    await submitBuildRun(started.runRequest);
  } catch (error) {
    m6$("m6-status").textContent = error.message;
    m6$("m6-status").dataset.state = "error";
  }
});

m6$("m6-iterate-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const requested = await m6request(
      `/api/build/projects/${encodeURIComponent(m6State.projectId)}/iterate`,
      {
        instruction: m6$("m6-instruction").value,
        ...(m6State.targetRef ? { targetRef: m6State.targetRef } : {}),
        rememberDecision: m6$("m6-remember").checked,
      },
    );
    m6$("m6-instruction").value = "";
    m6$("m6-remember").checked = false;
    await submitBuildRun(requested.runRequest);
  } catch (error) {
    m6$("m6-status").textContent = error.message;
    m6$("m6-status").dataset.state = "error";
  }
});

m6$("m6-target")?.addEventListener("change", m6UpdateTargetNote);
buildNav.addEventListener("click", () => void openBuild());
homeAction.addEventListener("click", () => void openBuild());
for (const button of panel.querySelectorAll("[data-m6-viewport]")) {
  button.addEventListener("click", () => {
    for (const other of panel.querySelectorAll("[data-m6-viewport]")) other.classList.toggle("selected", other === button);
    m6$("m6-preview").dataset.viewport = button.dataset.m6Viewport;
  });
}

document.addEventListener("click", (event) => {
  if (event.target.closest?.("#build-view, #m6-home-build, #build-panel")) return;
  if (event.target.closest?.(".nav-item, [data-project-section]")) panel.hidden = true;
});
