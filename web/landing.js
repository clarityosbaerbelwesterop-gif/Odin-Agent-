const experienceCss = document.createElement("link");
experienceCss.rel = "stylesheet";
experienceCss.href = "/product-experience-landing.css";
document.head.append(experienceCss);

const modes = {
  chat: {
    label: "CHAT / 01",
    title: "Ein Gespräch. Ein klarer nächster Schritt.",
    copy: "Fragen stellen, eine Antwort einordnen und direkt nachhaken. Chat hält einfache Aufgaben kompakt und kann für Berechnungen das Rechenwerkzeug nutzen.",
    steps: [
      "Aufgabe beschreiben",
      "Antwort und Rückfragen bearbeiten",
      "Im selben Gespräch weiterarbeiten",
    ],
    boundary:
      "Auch eine überzeugend formulierte Antwort kann falsch sein. Prüfe wichtige Aussagen anhand unabhängiger Quellen.",
    cta: "Chat öffnen",
  },
  coding: {
    label: "CODING / 02",
    title: "Von der Änderung zur Vorschau.",
    copy: "Dateien lesen, gezielt bearbeiten und die Änderungen nachvollziehen. Deine HTML-, CSS- und JavaScript-Seite erscheint in einer isolierten Vorschau.",
    steps: [
      "Dateien und Aufgabe prüfen",
      "Änderungen im Workspace anwenden",
      "Syntax prüfen, Vorschau ansehen",
    ],
    boundary:
      "Die gehostete Preview bearbeitet statische Web-Projekte. Sie installiert keine Pakete und startet keinen beliebigen Backend-Code.",
    cta: "Coding öffnen",
  },
  thinking: {
    label: "THINKING / 03",
    title: "Annahmen prüfen. Schlüsse nachvollziehen.",
    copy: "Zerlege eine knifflige Aufgabe, rechne Zwischenergebnisse nach und lass den Lösungsvorschlag in einem separaten Modelldurchlauf prüfen.",
    steps: [
      "Annahmen und Teilfragen ordnen",
      "Rechnen und Lösung erarbeiten",
      "Vorschlag prüfen und überarbeiten",
    ],
    boundary:
      "Eine zweite Modellprüfung ist keine unabhängige Wahrheitsgarantie. Du siehst Entscheidungszusammenfassungen, keine privaten Gedankengänge.",
    cta: "Thinking öffnen",
  },
  research: {
    label: "RESEARCH / 04",
    title: "Quellen daneben. Nicht irgendwo.",
    copy: "Recherchiere ein Thema mit abgerufenen Quellen. Die verwendeten Auszüge und Quellenlinks bleiben im Workspace an den Ergebnissen sichtbar.",
    steps: [
      "Frage und Suchbegriffe festlegen",
      "Wikipedia-Quellen abrufen",
      "Erkenntnisse mit Quellen zuordnen",
    ],
    boundary:
      "Research nutzt derzeit Wikipedia. Eine freie Websuche, Fachliteratur-Datenbanken und ein vollständiger Deep-Research-Dienst sind nicht angeschlossen.",
    cta: "Research öffnen",
  },
  ultra: {
    label: "ULTRA / 05",
    title: "Mehr Arbeitsschritte. Dieselben Grenzen.",
    copy: "Für Aufgaben, die Planung, Werkzeuge und Überarbeitung verbinden: Ultra erlaubt mehr begrenzte Arbeitsschritte und einen separaten Review-Durchlauf.",
    steps: [
      "Plan und Arbeitsschritte festhalten",
      "Passende Werkzeuge einsetzen",
      "Ergebnis prüfen und nachbessern",
    ],
    boundary:
      "Ultra verbraucht potenziell mehr Tokens. Es erhöht keine Berechtigungen und garantiert keinen Qualitätsgewinn. Zeit- und Anbieter-Limits bleiben bestehen.",
    cta: "Ultra öffnen",
  },
};

for (const button of document.querySelectorAll("[data-mode]")) {
  button.addEventListener("click", () => {
    const id = button.dataset.mode;
    const mode = modes[id];
    if (!mode) return;
    for (const item of document.querySelectorAll("[data-mode]"))
      item.setAttribute("aria-pressed", String(item === button));
    for (const [field, text] of Object.entries({
      label: mode.label,
      title: mode.title,
      copy: mode.copy,
      boundary: mode.boundary,
    }))
      document.getElementById(`mode-${field}`).textContent = text;
    const steps = document.getElementById("mode-steps");
    steps.replaceChildren();
    mode.steps.forEach((text, index) => {
      const item = document.createElement("li");
      const number = document.createElement("span");
      number.textContent = `0${index + 1}`;
      item.append(number, document.createTextNode(text));
      steps.append(item);
    });
    const open = document.getElementById("mode-open");
    open.href = `/app?mode=${id}`;
    open.textContent = `${mode.cta}`;
  });
}

const hero = document.querySelector(".hero");
const heroBottom = document.querySelector(".hero-bottom");
if (hero && heroBottom && !document.getElementById("odin-live-demo")) {
  const demo = document.createElement("section");
  demo.id = "odin-live-demo";
  demo.className = "landing-live-demo";
  demo.setAttribute("aria-label", "Odin product preview");
  demo.innerHTML = `<div class="landing-demo-bar"><span><i></i> ODIN IS WORKING</span><span>PRODUCT PREVIEW</span></div><div class="landing-demo-grid"><div class="landing-demo-stream"><div class="demo-step done"><b>✓</b><span><strong>Repository verstanden</strong><small>Struktur und relevante Dateien geprüft</small></span></div><div class="demo-step active"><b></b><span><strong>Tool · repo.patch</strong><small>src/routes/index.tsx · scoped change</small></span></div><div class="demo-step"><b></b><span><strong>Verifikation</strong><small>Tests starten nach der letzten Änderung</small></span></div></div><div class="landing-demo-artifact"><span>LIVE ARTIFACT</span><div class="demo-window"><i></i><i></i><i></i><h3>Your work,<br />already moving.</h3><p>Odin changes the actual workspace while the evidence stays visible.</p></div></div></div>`;
  heroBottom.after(demo);
}
