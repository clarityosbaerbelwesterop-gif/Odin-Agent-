# Odin – Datenschutzerklärung (Preview-Entwurf)

Stand: 9. September 2026 · Status: **PARTIALLY_VERIFIED / ENTWURF**. Betreiberangaben, Auftragsverarbeitungsverträge, konkrete Löschfristen und die produktive Anbieter-/Subprozessorenliste müssen vor öffentlichem kommerziellem Launch finalisiert und rechtlich geprüft werden.

## 1. Verantwortlicher

**[BETREIBERNAME / RECHTSFORM]**  
**[ANSCHRIFT]**  
E-Mail: **[DATENSCHUTZ-/SUPPORT-E-MAIL]**  
Datenschutzbeauftragter, falls gesetzlich erforderlich: **[KONTAKT ODER „nicht bestellt“]**

## 2. Welche Daten Odin aktuell verarbeitet

Je nach Nutzung verarbeitet Odin insbesondere Konto- und Authentifizierungsdaten, E-Mail-Adresse, Sitzungsdaten, Gesprächsinhalte, Prompts, Modellantworten, Aufgaben-/Missionsstatus, vom Nutzer bereitgestellte Workspace-Dateien und Änderungen, Rechercheanfragen/Quellen, technische Sicherheits- und Fehlerdaten sowie begrenzte Nutzungs-/Tokenmetadaten. Zahlungsdaten werden in der aktuellen Preview nicht verarbeitet, weil kein Odin-Kaufprozess aktiviert ist.

## 3. Zwecke und Rechtsgrundlagen

- Bereitstellung des angeforderten Dienstes, Konto, Chat, Coding und Research: Art. 6 Abs. 1 lit. b DSGVO bzw. vorvertragliche Maßnahmen.
- Sicherheit, Missbrauchsabwehr, technische Stabilität und begrenzte Diagnostik: Art. 6 Abs. 1 lit. f DSGVO; berechtigtes Interesse ist ein sicherer und zuverlässiger Betrieb.
- Erfüllung zwingender gesetzlicher Pflichten: Art. 6 Abs. 1 lit. c DSGVO.
- Nicht notwendige Analyse-/Marketingtechnologien würden – falls später eingeführt – nur auf einer dann erforderlichen Rechtsgrundlage, insbesondere Einwilligung, aktiviert. Der aktuelle Preview-Code setzt keine Marketing-/Tracking-Cookies.

## 4. Empfänger und technische Anbieter

Aktuell beobachtete Produktpfade:

- **Neon** für Postgres und Neon Auth. Das aktuelle Odin-Neon-Projekt läuft in `aws-eu-central-1`. Nutzerzeilen werden durch servergesetzten Identitätskontext und FORCE RLS getrennt.
- **Vercel** für Web-/Function-Hosting. Der verifizierte Preview-Function-Stand lief in `fra1`; Build-/Edge-/Unternehmensprozesse können außerhalb Deutschlands/EU stattfinden.
- **NVIDIA / konfigurierter Modellanbieter** für den derzeit im Hosted Runtime aktivierten Kimi-K3-Modellpfad, soweit eine Nutzeraufgabe Modellinferenz erfordert.
- **Wikimedia/Wikipedia** für Research-Suche und Quellenauszüge, wenn der Research-Modus genutzt wird.

Weitere Provideradapter (z. B. OpenAI, Anthropic, OpenRouter) sind im Repository vorhanden, werden aber nicht automatisch zu Empfängern. Ein Anbieter wird erst relevant, wenn er für den konkreten Runtime-Pfad konfiguriert und benutzt wird.

## 5. Internationale Übermittlungen

Soweit Empfänger oder Unterauftragnehmer Daten außerhalb des EWR verarbeiten, müssen die Voraussetzungen der Art. 44 ff. DSGVO erfüllt werden, etwa Angemessenheitsbeschluss oder geeignete Garantien einschließlich Standardvertragsklauseln, soweit erforderlich. Vor kommerziellem Launch sind die tatsächlich eingesetzten Auftragsverarbeiter, Unterauftragnehmer und Transfermechanismen vertraglich zu dokumentieren.

## 6. Speicherdauer

Konto-, Gesprächs-, Workspace- und Missionsdaten werden derzeit für die Funktionsfähigkeit der Preview gespeichert, bis sie gelöscht werden oder ihre Speicherung für Betrieb, Sicherheit bzw. gesetzliche Pflichten nicht mehr erforderlich ist. **Eine verbindliche produktive Fristenmatrix ist noch ein Launch-Gate.** Sicherheits-/Diagnosedaten sind technisch begrenzt und sollen nur solange aufbewahrt werden, wie der konkrete Sicherheits-/Betriebszweck dies rechtfertigt. Gesetzliche Aufbewahrungspflichten bleiben vorbehalten.

## 7. Cookies und Endgeräte

Die aktuelle Anwendung nutzt nur für Anmeldung/Sitzung notwendige, serverseitig gesetzte Cookies; sie sind Secure, HttpOnly und SameSite=Strict. Es gibt im aktuellen Preview-Pfad keine Marketing- oder Tracking-Cookies. § 25 Abs. 2 TDDDG sieht für unbedingt erforderliche Endgerätezugriffe zur Bereitstellung eines ausdrücklich gewünschten Dienstes eine Ausnahme von der Einwilligung vor. Werden später nicht notwendige Analyse-, Werbe- oder ähnliche Technologien ergänzt, muss die Einwilligungs-/Cookie-Logik neu bewertet werden.

## 8. Sicherheit

Zu den derzeit implementierten Kontrollen zählen TLS/HTTPS, serverseitige Provider-Credentials, verifizierte Auth-Sitzungen/JWT-Bindung, FORCE RLS auf den acht Anwendungstabellen, transaktionslokaler Nutzerkontext, begrenzte Raten/Timeouts, CSP, isolierte statische Vorschau sowie Secret-Redaction/-Reject-Regeln. Diese Maßnahmen reduzieren Risiken, ersetzen aber keine gesetzlich erforderliche laufende Risikoanalyse oder unabhängige Sicherheitsprüfung.

## 9. Rechte betroffener Personen

Betroffene können – soweit die Voraussetzungen vorliegen – Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21 DSGVO) verlangen. Einwilligungen können für die Zukunft widerrufen werden. Außerdem besteht ein Beschwerderecht bei einer zuständigen Datenschutzaufsichtsbehörde. Bis ein vollständiger Self-Service-Export/-Löschpfad live verifiziert ist, sind Anfragen an **[DATENSCHUTZ-/SUPPORT-E-MAIL]** zu richten.

## 10. Automatisierte Entscheidungen

Die aktuelle Preview ist nicht als System für ausschließlich automatisierte Entscheidungen mit rechtlicher oder ähnlich erheblicher Wirkung im Sinne von Art. 22 DSGVO vorgesehen. Modelle schlagen Inhalte/Aktionen vor; serverseitige Regeln kontrollieren Berechtigungen und Ausführung.

## 11. Änderungen

Die Erklärung wird angepasst, wenn sich Datenflüsse, Anbieter, Rechtsgrundlagen, Aufbewahrung oder Produktfunktionen ändern. Eine Änderung der Marketingbeschreibung allein darf nicht als Nachweis einer geänderten Datenschutzpraxis dienen.

Rechtsquellen: DSGVO <https://eur-lex.europa.eu/eli/reg/2016/679/oj>, § 25 TDDDG <https://www.gesetze-im-internet.de/ttdsg/__25.html>, § 5 DDG <https://www.gesetze-im-internet.de/ddg/__5.html>. Dieser Entwurf ist keine individuelle Rechtsberatung.
