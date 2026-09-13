const m5css = document.createElement("link");
m5css.rel = "stylesheet";
m5css.href = "/product-m5.css";
document.head.append(m5css);

const m5$ = (id) => document.getElementById(id);
const m5el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

async function m5request(path, body, method = body === undefined ? "GET" : "POST") {
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
    // Stable public error below.
  }
  if (!response.ok) {
    const error = new Error(data.message ?? "Skill request failed.");
    error.code = data.code;
    throw error;
  }
  return data;
}

const skillsPanel = m5$("skills-panel");
const skillState = {
  filter: "all",
  query: "",
  projectId: null,
  data: null,
  selected: null,
};

if (skillsPanel) {
  skillsPanel.classList.add("m5-skills");
  skillsPanel.innerHTML = `
    <header class="m5-hero">
      <div><span class="m5-eyebrow">SKILLS OS</span><h1>What can Odin do?</h1><p>Discover verified procedures, see their requirements, and choose where they are available. Installing a Skill never grants tool, network, credential, deployment, billing or database authority.</p></div>
      <button id="m5-create-skill" class="m5-primary" type="button">Create private Skill</button>
    </header>
    <div id="m5-policy" class="m5-policy" role="status"></div>
    <div class="m5-toolbar">
      <label><span>Search</span><input id="m5-search" type="search" placeholder="Search skills" maxlength="100" /></label>
      <label><span>Scope</span><select id="m5-scope"><option value="global">Global</option><option value="project">This Project</option></select></label>
      <div id="m5-filters" class="m5-filters" role="group" aria-label="Skill status filters">
        <button type="button" data-filter="all" class="selected">All</button>
        <button type="button" data-filter="INSTALLED">Installed</button>
        <button type="button" data-filter="AVAILABLE">Available</button>
        <button type="button" data-filter="REQUIRES_CONNECTION">Needs connection</button>
        <button type="button" data-filter="DISABLED">Disabled</button>
      </div>
    </div>
    <div class="m5-layout">
      <section><div id="m5-skill-grid" class="m5-grid" aria-live="polite"></div></section>
      <aside id="m5-detail" class="m5-detail"><div class="m5-empty"><span>◇</span><h2>Select a Skill</h2><p>Purpose, trust, permissions and connection requirements appear here.</p></div></aside>
    </div>
    <section class="m5-private"><div><span class="m5-eyebrow">PRIVATE / CUSTOM</span><h2>Your Skill drafts</h2><p>Drafts are inert until independently validated and verified. They cannot call tools merely because they exist.</p></div><div id="m5-drafts" class="m5-drafts"></div></section>`;
}

const draftDialog = document.createElement("dialog");
draftDialog.id = "m5-draft-dialog";
draftDialog.className = "m5-dialog";
draftDialog.innerHTML = `
  <form method="dialog" id="m5-draft-form">
    <span class="m5-eyebrow">CUSTOM SKILL</span>
    <h2>Create a safe private Skill draft</h2>
    <p>Describe the outcome in normal language. Odin stores an inert candidate; validation and independent verification remain separate gates.</p>
    <label>What should this Skill do?<textarea id="m5-draft-goal" rows="5" minlength="8" maxlength="600" required placeholder="Review landing pages for accessibility and produce prioritized findings."></textarea></label>
    <div class="m5-dialog-actions"><button type="button" id="m5-draft-cancel">Cancel</button><button type="submit" class="m5-primary">Create draft</button></div>
  </form>`;
document.body.append(draftDialog);

function m5ProjectFromUrl() {
  return new URLSearchParams(window.location.search).get("project");
}

function m5StatusLabel(status) {
  return {
    AVAILABLE: "Available",
    INSTALLED: "Installed",
    DISABLED: "Disabled",
    REQUIRES_CONNECTION: "Requires connection",
    UPDATE_AVAILABLE: "Update available",
    QUARANTINED: "Quarantined",
    INCOMPATIBLE: "Incompatible",
  }[status] ?? status;
}

function m5TrustLabel(trust) {
  return {
    BUILT_IN_VERIFIED: "Built-in verified",
    FIRST_PARTY: "First party",
    EXTERNAL_COMMUNITY: "External / community",
    PRIVATE_CUSTOM: "Private / custom",
  }[trust] ?? trust;
}

async function m5Load() {
  if (!skillsPanel || skillsPanel.hidden) return;
  const projectId = m5ProjectFromUrl();
  skillState.projectId = projectId;
  const scope = m5$("m5-scope");
  scope.querySelector('option[value="project"]').disabled = !projectId;
  if (!projectId && scope.value === "project") scope.value = "global";
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  m5$("m5-policy").textContent = "Loading verified Skill state…";
  try {
    skillState.data = await m5request(`/api/skills${query}`);
    m5$("m5-policy").textContent =
      "Installed ≠ authorized. M23 selects verified Skill packages; M25 still decides whether any declared tool, network or credential action is allowed.";
    m5Render();
  } catch (error) {
    m5$("m5-policy").textContent = error.message;
    m5$("m5-policy").dataset.state = "error";
  }
}

function m5Render() {
  m5RenderGrid();
  m5RenderDrafts();
  if (skillState.selected) {
    const selected = skillState.data?.skills?.find((skill) => skill.id === skillState.selected);
    if (selected) m5RenderDetail(selected);
    else skillState.selected = null;
  }
}

function m5RenderGrid() {
  const target = m5$("m5-skill-grid");
  if (!target) return;
  target.replaceChildren();
  const normalized = skillState.query.trim().toLowerCase();
  const skills = (skillState.data?.skills ?? []).filter((skill) => {
    if (skillState.filter !== "all" && skill.status !== skillState.filter) return false;
    if (!normalized) return true;
    return [skill.name, skill.purpose, skill.category, skill.publisher]
      .join(" ")
      .toLowerCase()
      .includes(normalized);
  });
  for (const skill of skills) {
    const card = m5el("button", undefined, "m5-card");
    card.type = "button";
    card.dataset.status = skill.status;
    card.dataset.selected = String(skill.id === skillState.selected);
    const top = m5el("div", undefined, "m5-card-top");
    top.append(
      m5el("span", skill.category, "m5-category"),
      m5el("span", m5StatusLabel(skill.status), "m5-status"),
    );
    card.append(
      top,
      m5el("h2", skill.name),
      m5el("p", skill.purpose),
      m5el("small", `${m5TrustLabel(skill.trust)} · v${skill.version}`),
    );
    if (skill.requiredConnections.length)
      card.append(m5el("span", `Requires ${skill.requiredConnections.join(", ")}`, "m5-requirement"));
    card.onclick = () => {
      skillState.selected = skill.id;
      m5RenderGrid();
      m5RenderDetail(skill);
    };
    target.append(card);
  }
  if (!skills.length)
    target.append(m5el("p", "No Skills match this view.", "m5-empty-copy"));
}

function m5RenderDetail(skill) {
  const target = m5$("m5-detail");
  target.replaceChildren();
  target.append(
    m5el("span", m5StatusLabel(skill.status), "m5-detail-status"),
    m5el("h2", skill.name),
    m5el("p", skill.purpose, "m5-detail-purpose"),
  );
  const facts = m5el("dl", undefined, "m5-facts");
  for (const [label, value] of [
    ["Trust", m5TrustLabel(skill.trust)],
    ["Publisher", skill.publisher],
    ["Version", skill.version],
    ["Verification", skill.verification],
    ["Risk", skill.risk],
    ["Authority", skill.canonicalAuthority],
  ]) {
    facts.append(m5el("dt", label), m5el("dd", value));
  }
  target.append(facts);
  target.append(m5List("Examples", skill.examples));
  target.append(m5List("Required tools", skill.requiredTools.length ? skill.requiredTools : ["None declared"]));
  target.append(
    m5List(
      "Connections",
      skill.requiredConnections.length
        ? skill.requiredConnections.map((name) =>
            skill.missingConnections.includes(name) ? `${name} · not connected` : `${name} · connected`,
          )
        : ["No connection required"],
    ),
  );
  target.append(m5List("Permission disclosure", skill.permissions));
  const actions = m5el("div", undefined, "m5-actions");
  const scope = m5$("m5-scope").value;
  const projectId = scope === "project" ? skillState.projectId : null;
  const installation =
    skill.installation && skill.installation.scope === scope && skill.installation.projectId === projectId
      ? skill.installation
      : null;
  if (skill.missingConnections.includes("github")) {
    const connect = m5el("button", "Connect GitHub", "m5-primary");
    connect.type = "button";
    connect.onclick = () => window.location.assign("/api/github/connect");
    actions.append(connect);
  }
  if (!installation) {
    const install = m5el("button", "Install", "m5-primary");
    install.type = "button";
    install.disabled = skill.status === "REQUIRES_CONNECTION" || !skill.supportedScopes.includes(scope);
    install.onclick = () =>
      m5Mutate("/api/skills/install", {
        skillId: skill.id,
        version: skill.version,
        contentHash: skill.contentHash,
        scope,
        ...(projectId ? { projectId } : {}),
      });
    actions.append(install);
  } else {
    const toggle = m5el("button", installation.enabled ? "Disable" : "Enable");
    toggle.type = "button";
    toggle.onclick = () =>
      m5Mutate("/api/skills/state", {
        skillId: skill.id,
        scope,
        ...(projectId ? { projectId } : {}),
        enabled: !installation.enabled,
        expectedContentHash: installation.contentHash,
      });
    actions.append(toggle);
    if (skill.status === "UPDATE_AVAILABLE") {
      const update = m5el("button", "Update", "m5-primary");
      update.type = "button";
      update.onclick = () =>
        m5Mutate("/api/skills/update", {
          skillId: skill.id,
          scope,
          ...(projectId ? { projectId } : {}),
          expectedContentHash: installation.contentHash,
        });
      actions.append(update);
    }
    if (installation.previousContentHash) {
      const rollback = m5el("button", "Rollback");
      rollback.type = "button";
      rollback.onclick = () =>
        m5Mutate("/api/skills/rollback", {
          skillId: skill.id,
          scope,
          ...(projectId ? { projectId } : {}),
          expectedContentHash: installation.contentHash,
        });
      actions.append(rollback);
    }
    const remove = m5el("button", "Remove", "m5-danger");
    remove.type = "button";
    remove.onclick = () =>
      m5Mutate(
        "/api/skills/install",
        {
          skillId: skill.id,
          scope,
          ...(projectId ? { projectId } : {}),
          expectedContentHash: installation.contentHash,
        },
        "DELETE",
      );
    actions.append(remove);
  }
  target.append(actions);
}

function m5List(title, values) {
  const section = m5el("section", undefined, "m5-detail-section");
  section.append(m5el("h3", title));
  const list = m5el("ul");
  for (const value of values) list.append(m5el("li", value));
  section.append(list);
  return section;
}

async function m5Mutate(path, body, method = "POST") {
  m5$("m5-policy").textContent = "Applying server-authoritative Skill state…";
  try {
    const result = await m5request(path, body, method);
    if (result.authorityGranted === true)
      throw new Error("Unsafe response: product Skill action unexpectedly granted authority.");
    await m5Load();
  } catch (error) {
    m5$("m5-policy").textContent = error.message;
    m5$("m5-policy").dataset.state = "error";
  }
}

function m5RenderDrafts() {
  const target = m5$("m5-drafts");
  if (!target) return;
  target.replaceChildren();
  for (const draft of skillState.data?.drafts ?? []) {
    const card = m5el("article", undefined, "m5-draft-card");
    card.append(
      m5el("span", "PRIVATE / CUSTOM", "m5-category"),
      m5el("h3", draft.name),
      m5el("p", draft.purpose),
      m5el("small", `${draft.status} · ${draft.scope} · no execution authority`),
    );
    target.append(card);
  }
  if (!(skillState.data?.drafts ?? []).length)
    target.append(m5el("p", "No private Skill drafts yet.", "m5-empty-copy"));
}

m5$("skills-view")?.addEventListener("click", () => queueMicrotask(() => void m5Load()));
m5$("m5-search")?.addEventListener("input", (event) => {
  skillState.query = event.target.value;
  m5RenderGrid();
});
m5$("m5-scope")?.addEventListener("change", () => {
  skillState.selected = null;
  m5Render();
});
for (const button of document.querySelectorAll("#m5-filters [data-filter]")) {
  button.addEventListener("click", () => {
    skillState.filter = button.dataset.filter;
    for (const other of document.querySelectorAll("#m5-filters [data-filter]"))
      other.classList.toggle("selected", other === button);
    m5RenderGrid();
  });
}
m5$("m5-create-skill")?.addEventListener("click", () => draftDialog.showModal());
m5$("m5-draft-cancel")?.addEventListener("click", () => draftDialog.close());
m5$("m5-draft-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const scope = m5$("m5-scope")?.value === "project" ? "project" : "global";
  const projectId = scope === "project" ? skillState.projectId : null;
  try {
    await m5request("/api/skills/custom", {
      goal: m5$("m5-draft-goal").value,
      scope,
      ...(projectId ? { projectId } : {}),
    });
    m5$("m5-draft-goal").value = "";
    draftDialog.close();
    await m5Load();
  } catch (error) {
    m5$("m5-policy").textContent = error.message;
    draftDialog.close();
  }
});

// PRODUCT M4 integration: append only canonical Skill runtime evidence. Missing evidence stays missing.
const m5RunSection = m5el("section", undefined, "m4-section m5-run-skills");
m5RunSection.innerHTML = '<div class="m4-section-title"><span>SKILLS USED</span><span id="m5-run-skill-count">0</span></div><div id="m5-run-skills" class="m4-evidence"></div>';
m5$("m4-run")?.append(m5RunSection);

async function m5RenderRunSkills(runId) {
  const target = m5$("m5-run-skills");
  if (!target || !runId) return;
  target.replaceChildren(m5el("p", "Loading canonical Skill evidence…", "m4-muted"));
  try {
    const result = await m5request(`/api/skills/runs/${encodeURIComponent(runId)}`);
    target.replaceChildren();
    m5$("m5-run-skill-count").textContent = String(result.evidence.length);
    for (const event of result.evidence) {
      const data = event.data ?? {};
      const card = m5el("article", undefined, "m4-evidence-card");
      card.append(
        m5el("span", event.type),
        m5el("strong", String(data.skillName ?? data.packId ?? "Skill evidence")),
        m5el(
          "small",
          `${String(data.reason ?? data.taskClass ?? "Selected by canonical runtime")} · ${new Date(event.createdAt).toLocaleString()}`,
        ),
      );
      target.append(card);
    }
    if (!result.evidence.length) target.append(m5el("p", result.note, "m4-muted"));
  } catch (error) {
    target.replaceChildren(m5el("p", error.message, "m4-muted"));
  }
}

async function m5RunIdAtIndex(index) {
  const projectId = m5ProjectFromUrl();
  if (!projectId) return null;
  const project = await m5request(`/api/projects/${encodeURIComponent(projectId)}`);
  return [...(project.turns ?? [])].reverse()[index]?.id ?? null;
}

document.addEventListener("click", async (event) => {
  const runRow = event.target.closest?.(".m4-run-row");
  if (runRow) {
    const rows = [...document.querySelectorAll(".m4-run-row")];
    const runId = await m5RunIdAtIndex(rows.indexOf(runRow));
    if (runId) await m5RenderRunSkills(runId);
  }
  const runsButton = event.target.closest?.('[data-project-section="runs"]');
  if (runsButton) {
    try {
      const runId = await m5RunIdAtIndex(0);
      if (runId) setTimeout(() => void m5RenderRunSkills(runId), 0);
    } catch {
      // M4 remains authoritative and renders its own errors.
    }
  }
});
