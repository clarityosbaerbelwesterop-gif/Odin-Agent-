const $ = (id) => document.getElementById(id);
const state = { session: null, page: null, prepared: null };
const sessionDialog = $("session-dialog");

function text(value) { return typeof value === "string" ? value : ""; }
function addActivity(message) {
  const li = document.createElement("li");
  li.textContent = message;
  $("activity").prepend(li);
  while ($("activity").children.length > 12) $("activity").lastElementChild?.remove();
}
function setNotice(message, error = false) {
  $("browser-notice").textContent = message;
  $("browser-notice").style.color = error ? "#9b3f34" : "";
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: { "Content-Type": "application/json", "X-Odin-Request": "1", ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(text(body.message) || text(body.error) || `Request failed (${response.status})`);
  return body;
}
function projectPath(suffix = "") {
  if (!state.session) throw new Error("Start a browser session first.");
  return `/api/browser/projects/${encodeURIComponent(state.session.projectId)}/sessions/${encodeURIComponent(state.session.id)}${suffix}`;
}
function renderSession() {
  const session = state.session;
  $("session-state").textContent = session ? session.state.replaceAll("_", " ") : "No browser session";
  $("companion-state").textContent = !session ? "Waiting for a safe scope" : session.state === "OUTCOME_UNKNOWN" ? "Checking an uncertain outcome" : session.state === "ACTIVE" ? "Working inside the approved scope" : session.state.toLowerCase();
  $("scope").textContent = session?.allowedOrigins?.join(" · ") || "—";
  $("run").textContent = session?.runId || "—";
  $("last-safe").textContent = session?.lastSafeActionId || "—";
}
function renderPage(evidence) {
  state.page = evidence;
  const root = $("browser-page");
  root.replaceChildren();
  const view = document.createElement("div"); view.className = "page-view";
  const meta = document.createElement("div"); meta.className = "page-meta";
  const trust = document.createElement("span"); trust.className = "trust-badge"; trust.textContent = "Untrusted web content";
  const url = document.createElement("span"); url.textContent = evidence.url;
  meta.append(trust, url);
  const title = document.createElement("h2"); title.textContent = evidence.title || new URL(evidence.url).hostname;
  const content = document.createElement("div"); content.className = "page-text"; content.textContent = evidence.text || "This page contained no readable text.";
  view.append(meta, title, content);
  if (evidence.links?.length) {
    const links = document.createElement("div"); links.className = "page-links";
    const heading = document.createElement("span"); heading.className = "panel-label"; heading.textContent = "LINKS"; links.append(heading);
    for (const item of evidence.links.slice(0, 12)) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = item.text || item.url;
      button.addEventListener("click", () => navigate(item.url)); links.append(button);
    }
    view.append(links);
  }
  if (evidence.forms?.length) {
    const forms = document.createElement("div"); forms.className = "page-forms";
    const heading = document.createElement("span"); heading.className = "panel-label"; heading.textContent = "FORMS · REVIEW BEFORE SUBMIT"; forms.append(heading);
    evidence.forms.slice(0, 6).forEach((form, index) => forms.append(buildForm(form, index)));
    view.append(forms);
  }
  root.append(view);
}
function buildForm(form, index) {
  const card = document.createElement("form"); card.className = "form-card";
  const values = new Map();
  for (const field of form.fields ?? []) {
    if (!field.name || field.type === "hidden") continue;
    const label = document.createElement("label"); label.textContent = field.name;
    const input = document.createElement("input"); input.name = field.name; input.required = field.required === true; input.type = ["email", "number", "date", "url"].includes(field.type) ? field.type : "text";
    input.addEventListener("input", () => values.set(field.name, input.value));
    card.append(label, input);
  }
  const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = `Review submission ${index + 1}`; card.append(submit);
  card.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fields = Object.fromEntries(values);
    await prepareAction({ operation: "submit", url: form.action, fields });
  });
  return card;
}
async function navigate(url) {
  if (!state.session) { sessionDialog.showModal(); return; }
  $("browser-url").value = url;
  $("current-action").textContent = `Reading ${url}`;
  try {
    const result = await api(projectPath("/observe"), { method: "POST", body: JSON.stringify({ url }) });
    state.session = result.session; renderSession(); renderPage(result.evidence); setNotice("Page read. Its content remains untrusted evidence."); addActivity(`Read ${new URL(result.evidence.url).hostname}`);
  } catch (error) { setNotice(error.message, true); addActivity(`Blocked: ${error.message}`); }
  finally { $("current-action").textContent = "No action in progress."; }
}
async function prepareAction(request) {
  try {
    const prepared = await api(projectPath("/prepare"), { method: "POST", body: JSON.stringify(request) });
    if (prepared.approvalRequired === false) {
      setNotice("Action prepared without changing external state."); return;
    }
    state.prepared = { request, ...prepared };
    $("approval-action").textContent = `${request.operation[0].toUpperCase()}${request.operation.slice(1)}`;
    $("approval-destination").textContent = prepared.targetUrl;
    $("approval-data").textContent = prepared.dataSummary;
    $("approval-card").hidden = false;
    $("current-action").textContent = "Waiting for your approval.";
    addActivity(`Approval required for ${request.operation}.`);
  } catch (error) { setNotice(error.message, true); }
}
async function approveAndExecute() {
  const prepared = state.prepared;
  if (!prepared) return;
  $("approval-approve").disabled = true;
  try {
    await api(projectPath("/approve"), { method: "POST", body: JSON.stringify({ actionId: prepared.actionId }) });
    const result = await api(projectPath("/execute"), { method: "POST", body: JSON.stringify({ ...prepared.request, actionId: prepared.actionId }) });
    state.session = result.session; renderSession();
    if (result.evidence) renderPage(result.evidence);
    if (result.outcome === "UNKNOWN") {
      setNotice("The request may have reached the site, but the outcome is unknown. Odin will not repeat it until external state is checked.", true);
      addActivity("Outcome unknown — automatic replay blocked.");
    } else { setNotice("Approved action completed once."); addActivity(`${prepared.request.operation} completed.`); }
  } catch (error) { setNotice(error.message, true); addActivity(`Action stopped: ${error.message}`); }
  finally {
    $("approval-approve").disabled = false; $("approval-card").hidden = true; state.prepared = null; $("current-action").textContent = "No action in progress.";
  }
}

$("session-new").addEventListener("click", () => sessionDialog.showModal());
$("session-cancel").addEventListener("click", () => sessionDialog.close());
$("session-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const projectId = $("project-id").value.trim(); const runId = $("run-id").value.trim();
  const allowedOrigins = $("origins").value.split(/\s+/u).map((value) => value.trim()).filter(Boolean);
  try {
    const result = await api(`/api/browser/projects/${encodeURIComponent(projectId)}/sessions`, { method: "POST", body: JSON.stringify({ runId, allowedOrigins, riskProfile: $("risk-profile").value }) });
    state.session = result.session; renderSession(); sessionDialog.close(); setNotice("Scoped browser session started. Redirects outside this scope will be blocked."); addActivity("Session started.");
  } catch (error) { setNotice(error.message, true); }
});
$("navigate").addEventListener("submit", (event) => { event.preventDefault(); navigate($("browser-url").value); });
$("approval-approve").addEventListener("click", approveAndExecute);
$("approval-cancel").addEventListener("click", () => { state.prepared = null; $("approval-card").hidden = true; $("current-action").textContent = "No action in progress."; addActivity("Action cancelled before approval."); });

const params = new URLSearchParams(location.search);
if (params.get("project")) $("project-id").value = params.get("project");
if (params.get("run")) $("run-id").value = params.get("run");
renderSession();
