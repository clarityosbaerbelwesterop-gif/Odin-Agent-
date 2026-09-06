const connection = document.querySelector("#connection");
const approvalResult = document.querySelector("#approval-result");

const transientFixture = {
  cursor: 14,
  mode: "online",
};

document.querySelector("#reconnect")?.addEventListener("click", () => {
  connection.textContent = `Reconnect requested from cursor ${transientFixture.cursor}. Server bootstrap is required if continuity fails.`;
});

document.querySelector("#approve")?.addEventListener("click", () => {
  approvalResult.textContent = "Approval intent captured in memory only; a fresh server challenge and command validation are still required.";
});

document.querySelector("#deny")?.addEventListener("click", () => {
  approvalResult.textContent = "Approval denied locally; no command is issued.";
});
