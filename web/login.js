const $ = (id) => document.getElementById(id);
const allowedModes = new Set(["login", "signup", "verify", "forgot", "reset"]);
let mode = "login";
let authConfig = null;
let busy = false;

function safeReturnTo() {
  const value = new URLSearchParams(window.location.search).get("returnTo");
  if (!value) return "/app";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith("/app"))
      return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // Ignore malformed or cross-origin redirect targets.
  }
  return "/app";
}

async function request(path, body, method = body === undefined ? "GET" : "POST") {
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
    // Public auth errors must remain usable even if an upstream returns no JSON body.
  }
  if (!response.ok) {
    const error = new Error(data.message ?? "Anmeldung konnte nicht abgeschlossen werden.");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

function status(text = "", kind = "") {
  $("auth-status").textContent = text;
  $("auth-status").className = `status${kind ? ` ${kind}` : ""}`;
}

function setBusy(next) {
  busy = next;
  $("auth-submit").disabled = next;
  $("github-signin").disabled = next;
  $("send-code").disabled = next;
  $("switch-mode").disabled = next;
  $("forgot-password").disabled = next;
  $("auth-submit").textContent = next ? "Bitte warten …" : submitLabel();
}

function submitLabel() {
  return {
    login: "Anmelden",
    signup: "Konto erstellen",
    verify: "E-Mail bestätigen",
    forgot: "Reset-Code anfordern",
    reset: "Neues Passwort speichern",
  }[mode];
}

function renderMode() {
  const content = {
    login: ["WILLKOMMEN ZURÜCK", "Bei Odin anmelden", "Öffne deinen Workspace und setze deine Missionen fort."],
    signup: ["NEUES KONTO", "Odin Account erstellen", "Erstelle deine Identity. Danach bestätigst du deine E-Mail."],
    verify: ["E-MAIL BESTÄTIGEN", "Konto verifizieren", "Fordere einen sechsstelligen Code an und bestätige deine Adresse."],
    forgot: ["PASSWORT RESET", "Zugang wiederherstellen", "Wir senden einen Reset-Code, wenn für die Adresse ein Konto existiert."],
    reset: ["NEUES PASSWORT", "Passwort neu setzen", "Gib den Reset-Code und ein neues Passwort mit mindestens 14 Zeichen ein."],
  }[mode];
  $("form-eyebrow").textContent = content[0];
  $("login-title").textContent = content[1];
  $("form-copy").textContent = content[2];
  $("name-field").hidden = mode !== "signup";
  $("code-field").hidden = !["verify", "reset"].includes(mode);
  $("password-field").hidden = ["verify", "forgot"].includes(mode);
  $("forgot-password").hidden = mode !== "login";
  $("send-code").hidden = mode !== "verify";
  $("auth-name").required = mode === "signup";
  $("auth-code").required = ["verify", "reset"].includes(mode);
  $("auth-password").required = !["verify", "forgot"].includes(mode);
  $("auth-password").minLength = ["signup", "reset"].includes(mode) ? 14 : 1;
  $("auth-password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("auth-submit").textContent = submitLabel();
  $("switch-row").firstChild.textContent = mode === "login" ? "Noch kein Konto? " : "Zurück zur Anmeldung? ";
  $("switch-mode").textContent = mode === "login" ? "Registrieren" : "Anmelden";
  status();
}

function setMode(next) {
  if (!allowedModes.has(next) || busy) return;
  mode = next;
  renderMode();
  if (mode === "verify") $("auth-code").focus();
  else $("auth-email").focus();
}

async function restoreSession() {
  try {
    await request("/api/config");
    window.location.replace(safeReturnTo());
    return true;
  } catch (error) {
    if (error.status !== 401 && error.status !== 403) status(error.message, "error");
    return false;
  }
}

async function initialize() {
  setBusy(true);
  try {
    if (await restoreSession()) return;
    authConfig = await request("/api/auth/config");
    const github = authConfig?.oauth?.github;
    if (github?.available === true) {
      $("github-note").textContent = "Melde dich mit GitHub an. Repository-Zugriff wird separat und nur bei Bedarf freigegeben.";
    } else {
      $("github-note").textContent = "GitHub Login ist für dieses Deployment noch nicht freigeschaltet. E-Mail Login funktioniert weiterhin.";
    }
  } catch (error) {
    status(error.message, "error");
  } finally {
    setBusy(false);
  }
}

$("github-signin").addEventListener("click", async () => {
  if (busy) return;
  const github = authConfig?.oauth?.github;
  if (github?.available !== true || typeof github.start !== "string") {
    status("GitHub Login benötigt noch die einmalige OAuth-Konfiguration für Odin Identity.", "error");
    return;
  }
  setBusy(true);
  status("GitHub wird geöffnet …");
  try {
    const target = new URL(github.start, window.location.origin);
    if (target.origin !== window.location.origin) throw new Error("Unsicheres Login-Ziel wurde blockiert.");
    target.searchParams.set("returnTo", safeReturnTo());
    window.location.assign(target.href);
  } catch (error) {
    status(error.message, "error");
    setBusy(false);
  }
});

$("switch-mode").addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));
$("forgot-password").addEventListener("click", () => setMode("forgot"));

$("send-code").addEventListener("click", async () => {
  if (busy) return;
  const email = $("auth-email").value.trim();
  if (!email || !$("auth-email").checkValidity()) {
    $("auth-email").reportValidity();
    return;
  }
  setBusy(true);
  try {
    await request("/api/auth/sendCode", { email });
    status("Bestätigungscode wurde angefordert. Prüfe dein Postfach.", "success");
  } catch (error) {
    status(error.message, "error");
  } finally {
    setBusy(false);
  }
});

$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const otp = $("auth-code").value.trim();
  const name = $("auth-name").value.trim();
  for (const input of $("auth-form").querySelectorAll("input")) input.removeAttribute("aria-invalid");
  if (!$("auth-form").checkValidity()) {
    $("auth-form").reportValidity();
    return;
  }
  setBusy(true);
  status();
  try {
    const body = { email };
    if (!["verify", "forgot"].includes(mode)) body.password = password;
    if (mode === "signup") body.name = name;
    if (["verify", "reset"].includes(mode)) body.otp = otp;
    await request(`/api/auth/${mode}`, body);
    if (mode === "login") {
      status("Angemeldet. Workspace wird geöffnet …", "success");
      window.location.replace(safeReturnTo());
      return;
    }
    if (mode === "signup") {
      $("auth-password").value = "";
      setMode("verify");
      status("Konto erstellt. Fordere jetzt deinen Bestätigungscode an.", "success");
    } else if (mode === "forgot") {
      setMode("reset");
      status("Wenn ein Konto existiert, wurde ein Reset-Code gesendet.", "success");
    } else if (mode === "verify") {
      $("auth-code").value = "";
      setMode("login");
      status("E-Mail bestätigt. Du kannst dich jetzt anmelden.", "success");
    } else if (mode === "reset") {
      $("auth-password").value = "";
      $("auth-code").value = "";
      setMode("login");
      status("Passwort aktualisiert. Du kannst dich jetzt anmelden.", "success");
    }
  } catch (error) {
    status(error.message, "error");
  } finally {
    setBusy(false);
  }
});

renderMode();
void initialize();
