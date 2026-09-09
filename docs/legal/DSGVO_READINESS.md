# DSGVO / deutscher Digitaldienst – Launch-Readiness

Stand: 9. September 2026 · Gesamtstatus: **PARTIALLY_VERIFIED**

Diese Matrix ist technische/compliance-orientierte Arbeitsdokumentation, keine Rechtsberatung und keine Freigabe für einen entgeltlichen öffentlichen Launch.

| Bereich | Stand | Evidenz / nächster Schritt |
| --- | --- | --- |
| Identität & Sitzungen | VERIFIED preview | Neon Auth, serverseitige Sessionprüfung, E-Mail-Verifikationspflicht; realer Integrationslauf `34220256588` |
| Mandantentrennung | VERIFIED preview | FORCE RLS auf acht Anwendungstabellen; Zwei-Nutzer-/Fremdzugriffstests |
| Secrets | VERIFIED repository/preview | Provider-Credentials serverseitig; Secret-Redaction/deny-by-default |
| Hosting-Region | OBSERVED | Neon `aws-eu-central-1`; verifizierte Vercel Function `fra1`; daraus folgt **keine** Zusage „alle Verarbeitung EU-only“ |
| Nicht notwendiges Tracking | NOT PRESENT | aktueller Preview-Pfad hat keine Marketing-/Tracking-Cookies; bei späterer Einführung § 25 TDDDG neu prüfen |
| Datenschutzhinweise | DRAFT | `DATENSCHUTZERKLAERUNG_DE.md`; Betreiber/Empfänger/Fristen finalisieren |
| Nutzungsbedingungen | DRAFT | `EULA_DE.md`; vor Paid Launch juristisch prüfen |
| Impressum / DDG §5 | BLOCKED | Betreibername, ladungsfähige Anschrift, E-Mail und ggf. Register/USt-/Aufsichtsangaben fehlen |
| AV-Verträge / Unterauftragsverarbeiter | BLOCKED | Vercel/Neon/Modellprovider/Wikimedia-Flows und jeweils geltende DPA/Subprozessoren/Transfergrundlage produktiv dokumentieren |
| Drittlandtransfers | PARTIAL | Art. 44 ff. DSGVO im Entwurf abgebildet; konkrete Anbieter-/SCC-/Angemessenheitsprüfung offen |
| Lösch-/Aufbewahrungsplan | BLOCKED | konkrete Fristen je Datentyp, Logs, Backups und gesetzliche Pflichten festlegen |
| Betroffenenrechte | PARTIAL | rechtliche Kontaktstrecke vorgesehen; vollständiger Self-Service Export/Löschung noch nicht live verifiziert |
| E-Mail-Zustellung | OPEN | echte human signup/verify/reset Zustellung noch als Acceptance Gate offen |
| Billing / Verbraucherinfos | NOT ENABLED | keine Paid-Pläne, Stripe-Entitlements oder Preise live; vor Aktivierung Preis/Laufzeit/Kündigung/Widerruf/Steuern prüfen |
| Produktion | NOT APPROVED | Preview-Migration ≠ Produktionsmigration; M12/M26 Live-Isolation bleibt eigenes Gate |

## Rechtsgrundlagen, die der Launch-Prozess berücksichtigen muss

- Art. 13 DSGVO: transparente Informationen über Verantwortlichen, Zwecke/Rechtsgrundlagen, Empfänger/Transfers, Speicherdauer und Betroffenenrechte.
- Art. 28 DSGVO: geeignete Vereinbarungen mit Auftragsverarbeitern.
- Art. 32 DSGVO: risikogerechte technische und organisatorische Maßnahmen sowie regelmäßige Überprüfung.
- Art. 44 ff. DSGVO: Voraussetzungen für Drittlandübermittlungen.
- § 25 TDDDG: Einwilligung für Endgerätezugriffe, soweit keine Ausnahme – insbesondere unbedingt erforderliche Bereitstellung – greift.
- § 5 DDG: leicht erkennbare, unmittelbar erreichbare und ständig verfügbare Anbieterinformationen für geschäftsmäßige, in der Regel entgeltliche digitale Dienste.

## Release Gate

Ein öffentlicher kommerzieller „DSGVO-konform“-Claim ist gesperrt, bis mindestens Betreiber-/Impressumsdaten, Datenschutzkontakt, produktive Anbieter-/DPA-/Transferprüfung, konkrete Retention, Betroffenenrechtsprozess, echte E-Mail-Akzeptanz, produktive Infrastruktur und eine geeignete Rechtsprüfung abgeschlossen sind.
