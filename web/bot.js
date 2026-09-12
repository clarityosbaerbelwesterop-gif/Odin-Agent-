const $ = (id) => document.getElementById(id);
let snapshot = null;
let selectedTask = null;

async function api(path, options = {}) {
  const method = options.method ?? "GET";
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(method === "GET" ? {} : { "Content-Type": "application/json", "X-Odin-Request": "1" }),
      ...(options.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  const authenticationRequired =
    response.status === 401 || (response.status === 403 && data.code === "EMAIL_UNVERIFIED");
  if (authenticationRequired) {
    const login = new URL("/login", location.origin);
    login.searchParams.set("returnTo", "/bot");
    if (data.code === "EMAIL_UNVERIFIED") login.searchParams.set("verify", "1");
    location.assign(`${login.pathname}${login.search}`);
    const error = new Error("Authentication required");
    error.code = data.code;
    throw error;
  }
  if (!response.ok) throw new Error(data.message ?? "Odin Bot request failed.");
  return data;
}

const terminal = new Set(["done", "cancelled", "failed", "blocked"]);
const statusLabel = (value) =>
  ({
    queued: "Queued",
    working: "Working",
    waiting: "Waiting",
    approval: "Needs approval",
    blocked: "Blocked",
    done: "Done",
    cancelled: "Stopped",
    failed: "Failed",
  })[value] ?? value;

function row(task) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "task-row";
  button.innerHTML = `<span class="task-copy"><strong></strong><small></small></span><span class="task-state"></span>`;
  button.querySelector("strong").textContent = task.goal;
  button.querySelector("small").textContent = task.currentStep;
  button.querySelector(".task-state").textContent = statusLabel(task.status);
  button.addEventListener("click", () => openTask(task.id));
  return button;
}

function renderRows(target, items, empty) {
  target.replaceChildren();
  if (!items.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = empty;
    target.append(p);
    return;
  }
  for (const item of items) target.append(row(item));
}

function render() {
  if (!snapshot) return;
  const tasks = snapshot.tasks ?? [];
  const active = tasks.filter((item) => !terminal.has(item.status));
  const recent = tasks.filter((item) => terminal.has(item.status)).slice(0, 8);
  $("active-count").textContent = String(active.length);
  renderRows($("active"), active, "Nothing needs attention right now.");
  renderRows($("recent"), recent, "Completed work will appear here.");

  const scheduled = $("scheduled");
  scheduled.replaceChildren();
  for (const item of snapshot.automations ?? []) {
    const node = document.createElement("div");
    node.className = "schedule-row";
    const when = item.nextWakeupAt
      ? new Date(item.nextWakeupAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
      : "Event driven";
    node.innerHTML = `<span><strong></strong><small></small></span><button type="button">Remove</button>`;
    node.querySelector("strong").textContent = item.name;
    node.querySelector("small").textContent = when;
    node.querySelector("button").addEventListener("click", async () => {
      await api(`/api/bot/automations/${item.id}`, { method: "DELETE", body: "{}" });
      await load();
    });
    scheduled.append(node);
  }
  if (!(snapshot.automations ?? []).length)
    scheduled.innerHTML = '<p class="empty">No automations yet.</p>';

  const inbox = $("inbox");
  inbox.replaceChildren();
  for (const item of snapshot.inbox ?? []) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "inbox-row";
    node.innerHTML = `<span><strong></strong><small></small></span><b></b>`;
    node.querySelector("strong").textContent = item.title;
    node.querySelector("small").textContent = item.body;
    node.querySelector("b").textContent = item.category.toUpperCase();
    if (item.taskId) node.addEventListener("click", () => openTask(item.taskId));
    inbox.append(node);
  }
  if (!(snapshot.inbox ?? []).length)
    inbox.innerHTML = '<p class="empty">No approvals or alerts.</p>';
  $("inbox-count").textContent = String(
    (snapshot.inbox ?? []).filter((item) => !item.readAt).length,
  );
  $("plan-pill").textContent = snapshot.testing?.preStripeAccess
    ? "TEST ACCESS"
    : String(snapshot.limits?.plan ?? "pro").toUpperCase();
  renderConnectors();
}

function renderConnectors() {
  const target = $("connectors");
  if (!target || !snapshot) return;
  target.replaceChildren();
  const github = snapshot.connectors?.github;
  const cards = [
    [
      "GitHub",
      github?.ready
        ? `${github.repository} · ${github.branch}`
        : github?.connected
          ? "Account verbunden · Repository auswählen"
          : "Nicht verbunden",
    ],
    [
      "Research",
      snapshot.connectors?.research?.connected
        ? snapshot.connectors.research.label
        : "Nicht verbunden",
    ],
    ["Modelle", `${snapshot.connectors?.models?.length ?? 0} serverseitig verfügbar`],
  ];
  for (const [name, detail] of cards) {
    const card = document.createElement("div");
    card.className = "connector-card";
    const strong = document.createElement("strong");
    const small = document.createElement("small");
    strong.textContent = name;
    small.textContent = detail;
    card.append(strong, small);
    target.append(card);
  }
  const model = $("bot-model");
  const current = model.value;
  model.replaceChildren(new Option("Auto model", ""));
  for (const item of snapshot.connectors?.models ?? [])
    model.append(new Option(`${item.label} · ${item.provider}`, item.id));
  if ([...model.options].some((option) => option.value === current)) model.value = current;
}

async function load() {
  try {
    snapshot = await api("/api/bot");
    render();
    $("status").textContent = "";
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function openTask(id) {
  const data = await api(`/api/bot/tasks/${id}`);
  selectedTask = data.task;
  $("detail-goal").textContent = selectedTask.goal;
  $("detail-state").textContent = statusLabel(selectedTask.status);
  $("detail-step").textContent = selectedTask.currentStep;
  const events = $("events");
  events.replaceChildren();
  for (const event of data.events ?? []) {
    const node = document.createElement("div");
    node.className = "event";
    const time = new Date(event.createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    node.innerHTML = `<time></time><span></span>`;
    node.querySelector("time").textContent = time;
    node.querySelector("span").textContent = String(event.data?.step ?? event.type);
    events.append(node);
  }
  const advanced = $("advanced");
  advanced.innerHTML = "";
  const details = {
    Agent: selectedTask.agent,
    Mode: selectedTask.mode,
    Priority: selectedTask.priority,
    "Last checkpoint": selectedTask.checkpointVersion,
    "Next wake-up": selectedTask.nextWakeupAt
      ? new Date(selectedTask.nextWakeupAt).toLocaleString()
      : "—",
    Mission: selectedTask.turnId ?? "Not started",
  };
  for (const [name, value] of Object.entries(details)) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = name;
    dd.textContent = String(value);
    advanced.append(dt, dd);
  }
  $("stop-task").hidden = terminal.has(selectedTask.status);
  $("detail").showModal();
}

$("task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const goal = $("goal").value.trim();
  if (!goal) return;
  $("status").textContent = "Handing this to Odin…";
  try {
    const created = await api("/api/bot/tasks", {
      method: "POST",
      body: JSON.stringify({
        goal,
        mode: $("bot-mode").value,
        modelId: $("bot-model").value || undefined,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    $("goal").value = "";
    await load();
    if (created.task?.id) await openTask(created.task.id);
  } catch (error) {
    $("status").textContent = error.message;
  }
});

$("schedule-toggle").addEventListener("click", () => {
  $("schedule-form").hidden = !$("schedule-form").hidden;
  if (!$("schedule-form").hidden) $("schedule-instruction").focus();
});

$("schedule-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const instruction = $("schedule-instruction").value.trim();
  if (!instruction) return;
  try {
    await api("/api/bot/automations", {
      method: "POST",
      body: JSON.stringify({
        instruction,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    $("schedule-instruction").value = "";
    $("schedule-form").hidden = true;
    await load();
  } catch (error) {
    $("status").textContent = error.message;
  }
});

$("detail-close").addEventListener("click", () => $("detail").close());
$("stop-task").addEventListener("click", async () => {
  if (!selectedTask) return;
  await api(`/api/bot/tasks/${selectedTask.id}/control`, {
    method: "POST",
    body: JSON.stringify({ command: "cancel" }),
  });
  $("detail").close();
  await load();
});

await load();
setInterval(() => {
  if (document.visibilityState === "visible") void load();
}, 8000);
