const fixture = Object.freeze({
  cursor: 42,
  events: [
    { cursor: 39, jobId: "inspect-repo", status: "SUCCEEDED", type: "job.succeeded" },
    { cursor: 42, jobId: "verify-change", status: "RUNNING", type: "job.heartbeat" },
  ],
  projection: {
    budgetLimits: {
      attempts: 20,
      costMicros: 2_000_000,
      inputTokens: 120_000,
      outputTokens: 40_000,
      toolCalls: 80,
    },
    budgetUsage: {
      attempts: 7,
      costMicros: 620_000,
      inputTokens: 38_000,
      outputTokens: 11_000,
      toolCalls: 27,
    },
    focus: "complex",
    jobs: {
      BLOCKED: 0,
      CANCELLED: 0,
      CANCELLING: 0,
      PENDING: 2,
      RETRY_WAIT: 0,
      RUNNING: 1,
      SUCCEEDED: 4,
    },
    missionId: "fixture-mission",
    objective: "Verify a bounded coding mission and preserve durable recovery evidence.",
    resumeState: null,
    state: "EXECUTING",
    tasks: [
      { id: "inspect", status: "VERIFIED", title: "Inspect repository" },
      { id: "change", status: "VERIFIED", title: "Apply scoped change" },
      { id: "verify", status: "RUNNING", title: "Run independent verification" },
    ],
    verification: { evidenceRefs: ["evidence:quality-gate"], status: "PENDING" },
    version: 18,
  },
});

const missionState = required("mission-state");
const cancelDialog = document.querySelector("#cancel-dialog");

render(fixture);

required("pause-control").addEventListener("click", () => {
  missionState.textContent = "PAUSED (fixture intent)";
});

required("resume-control").addEventListener("click", () => {
  missionState.textContent = "EXECUTING (fixture intent)";
});

required("cancel-control").addEventListener("click", () => {
  if (cancelDialog instanceof HTMLDialogElement) cancelDialog.showModal();
});

if (cancelDialog instanceof HTMLDialogElement) {
  cancelDialog.addEventListener("close", () => {
    if (cancelDialog.returnValue === "confirm")
      missionState.textContent = "CANCELLED (fixture intent)";
  });
}

function render(state) {
  const projection = state.projection;
  required("mission-title").textContent = `Mission · ${projection.missionId}`;
  required("mission-state").textContent = projection.state;
  required("mission-objective").textContent = projection.objective;
  required("mission-version").textContent = String(projection.version);
  required("mission-focus").textContent = projection.focus;
  required("verification-state").textContent = projection.verification.status;
  required("cursor-state").textContent = `Cursor ${state.cursor}`;

  replaceList(
    required("task-list"),
    projection.tasks.map((task) => `${task.title} · ${task.status}`),
  );

  const budgetGrid = required("budget-grid");
  budgetGrid.replaceChildren(
    ...Object.keys(projection.budgetLimits).map((key) =>
      metricCard(
        "budget-card",
        key,
        `${projection.budgetUsage[key]} / ${projection.budgetLimits[key]}`,
        "budget",
      ),
    ),
  );

  const workerCounts = required("worker-counts");
  workerCounts.replaceChildren(
    ...Object.entries(projection.jobs).map(([status, count]) =>
      metricCard("worker-card", status, String(count), "worker"),
    ),
  );

  replaceList(
    required("activity-list"),
    state.events.map(
      (event) => `#${event.cursor} · ${event.jobId} · ${event.type} · ${event.status}`,
    ),
  );

  required("evidence-summary").textContent =
    `Verification status: ${projection.verification.status}`;
  replaceList(required("evidence-list"), projection.verification.evidenceRefs);
}

function metricCard(className, label, value, prefix) {
  const card = document.createElement("div");
  card.className = className;
  const labelElement = document.createElement("div");
  labelElement.className = `${prefix}-label`;
  labelElement.textContent = label;
  const valueElement = document.createElement("div");
  valueElement.className = `${prefix}-value`;
  valueElement.textContent = value;
  card.append(labelElement, valueElement);
  return card;
}

function replaceList(element, items) {
  const nodes = items.map((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    return item;
  });
  element.replaceChildren(...nodes);
}

function required(id) {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing fixture element: ${id}`);
  return element;
}
