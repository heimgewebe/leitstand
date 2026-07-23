---
id: docs.blueprints.operator-decision-axis
title: "Blueprint: Operator Decision Axis v1"
doc_type: architecture
status: active
canonicality: supporting
owner: leitstand
summary: >
  Project canonical Bureau and Grabowski decision evidence into five bounded,
  source-bound, read-only Leitstand sections without creating new authority.
---

# Operator Decision Axis v1

Task: `OPERATOR-MACHINE-READABILITY-V1-T024`

## Ziel

Der Leitstand zeigt eine read-only Entscheidungsprojektion für fünf Fragen:

- **Jetzt** – der erste aktuell von Bureaus bestehender Statusprojektion aus der kanonischen Registry-Queue vorgeschlagene Task;
- **Im Fokus** – der jüngste aktive Thread-Fokus aus dem Bureau Live Register;
- **Blockiert** – explizite `blocked_reasons` beziehungsweise ein belegter blockierter Zustand aus Bureaus Statusprojektion;
- **Konvergenz** – die bestehende Grabowski-`current_work`-Konvergenzprojektion;
- **Danach** – weitere von Bureaus bestehender Statusprojektion aus der kanonischen Registry-Queue vorgeschlagene Tasks.

Die Achse ist ausschließlich eine Projektion. Sie erzeugt keine Task-, Queue-, Prioritäts-, Fokus-, Blocking-, Runtime- oder Konvergenzwahrheit.

## Wahrheitsgrenzen

| Abschnitt | Primär-/Projektionsquelle | Leitstand darf nicht |
| --- | --- | --- |
| Jetzt | Bureau `status-projection`, Quelle `registry-queue` | Task priorisieren, claimen oder dispatchen |
| Im Fokus | Bureau Live Register, jüngster aktiver Thread-Fokus | Fokus schreiben, schließen oder als Queue-Wahrheit behandeln |
| Blockiert | Bureau `status-projection` | Blocker erfinden oder selbst auflösen |
| Konvergenz | Grabowski `current_work` | Lifecycle-Zustand, Leases oder Prozesse mutieren |
| Danach | Bureau `status-projection`, Quelle `registry-queue` | eigene Backlog- oder Prioritätsliste führen |

Bureau bleibt Aufgaben- und Prioritätsautorität. Grabowski bleibt Ausführungsoperator. GitHub, CI und Runtime bleiben ihre jeweiligen Primärquellen. Der Leitstand speichert nur ein kurzlebiges Snapshot-Artefakt.

## Datenfluss

1. `scripts/leitstand-export-operator-snapshots` läuft producer-seitig außerhalb des HTTP-Request-Pfads.
2. Der Producer bindet Bureau-Registry-Daten weiterhin an das digest-validierte kanonische Runtime-Snapshot.
3. Der Producer liest Bureaus bestehende read-only Projektionen `status-projection` und `live-list`.
4. Der Producer liest Grabowskis bestehende `current_work`-Projektion für Konvergenzevidenz.
5. `scripts/export-operator-snapshots.mjs` begrenzt die Abschnitte und schreibt atomar `artifacts/operator-decision-axis.json` mit Contract-Kind `leitstand_operator_decision_axis_snapshot`.
6. `src/controllers/decisionAxis.ts` liest ausschließlich dieses Artefakt. Es gibt keinen request-time Aufruf von Bureau oder Grabowski.
7. Das Dashboard rendert Quelle, Frische und einen expliziten Degradierungszustand je Abschnitt.

## Degradierung

Fehlt eine Producer-Quelle, wird der betroffene Abschnitt als `unavailable` mit leerer Item-Liste geschrieben. Liefert eine gültige Quelle aktuell keinen belegten Eintrag, lautet der Status `unknown`; der Leitstand füllt keinen Ersatzwert ein. Ein Abschnitt wird nach 20 Minuten ohne neue Beobachtung als `stale` dargestellt.

## Bounds und Nicht-Ansprüche

Jeder Abschnitt ist auf höchstens acht Items begrenzt. Das Snapshot nennt explizit unter anderem folgende Nicht-Ansprüche:

- keine Task- oder Prioritätsautorität;
- keine Queue-Wahrheit;
- keine Fokusautorität;
- keine Runtime- oder Konvergenzautorität;
- keine Dispatch- oder Mutationsautorität.

## Verifikation

Verifiziert durch:

- `tests/controllers/decisionAxis.test.ts` – vollständige fünf Abschnitte, stale/missing, keine erfundenen Werte;
- `tests/exportDecisionAxis.test.ts` – bounded Snapshot und Nicht-Ansprüche;
- `tests/operatorSnapshotWrapper.test.ts` – kanonisch digest-gebundene Bureau-Quelle;
- `tests/controllers/dashboardAuthority.test.ts` und Repository-CI – bestehende Observer-Grenzen bleiben erhalten.
