---
id: docs.operations.storage-health
title: Bounded Storage Health Projection
status: active
doc_type: runbook
canonicality: canonical
summary: >
  Contract, retention, truth semantics and deployment procedure for the read-only Heim-PC storage-health projection consumed by Leitstand.
---

# Bounded Storage Health Projection

## Zweck und Systemgrenze

Leitstand zeigt den Speicherzustand des Heim-PC, erzeugt aber keine eigene Systemwahrheit und führt keine Bereinigung aus.

Die Datenkette ist bewusst getrennt:

1. `heim-pc/scripts/storage_inventory.py` beobachtet Dateisystem, Erzeugerbudgets und unzugeordnete Kandidaten read-only.
2. `heim-pc/scripts/cache_maintenance.py plan --no-write` beobachtet Wartungsziele und Sicherheitsblocker, ohne Wirkung zu autorisieren.
3. `scripts/storage-health-snapshot.mjs` verdichtet beide Belege in den Leitstand-Vertrag `leitstand_storage_health`.
4. `src/controllers/storageHealth.ts` validiert den Vertrag fail-closed.
5. `/storage-health` rendert ausschließlich die validierte Projektion.

Der Collector erteilt keine Löschbefugnis, bestätigt keine vollständige Prozessbeobachtung und prognostiziert kein zukünftiges Speicherwachstum.

## Gebundene Zeitreihen

Der Vertrag verwendet keine unbeschränkte Append-Datei.

| Fenster | Schlüssel | Standardgrenze | Verhalten |
| --- | --- | ---: | --- |
| Stunde | UTC-Stundenbeginn | 168 | Ein erneuter Lauf in derselben Stunde ersetzt exakt diesen Bucket. |
| Tag | UTC-Datum | 90 | Ein erneuter Lauf am selben Tag ersetzt die Erzeugerdetails dieses Tages. |
| Meldungen | Zustandsübergang | 128 | Nur echte Übergänge werden aufgenommen; älteste Einträge fallen an der Grenze heraus. |

Alle Fenster werden eindeutig und streng aufsteigend gespeichert. Ein vorhandenes Artefakt mit doppelten, nicht monotonen oder übergroßen Fenstern wird nicht geglättet, sondern als korrupt abgewiesen.

Harte konfigurierbare Maxima:

- Stunden: 744;
- Tage: 366;
- Meldungen: 512.

Auch verschachtelte Beobachtungen sind hart begrenzt: höchstens 512 Erzeuger, 512 unzugeordnete Artefakte, 256 Wartungsklassen, 513 Cleanup-Blocker und 514 Budgetsignale. Eine Quelle oberhalb dieser Grenzen wird fail-closed abgewiesen statt abgeschnitten oder still geglättet.

## Wahrheitszustände

Jede entscheidungsrelevante Anzeige trägt genau einen Wahrheitszustand:

- `observed`: direkt aus einem gültigen Quellbeleg übernommen oder aus einem exakt 24 Stunden alten Bucket berechnet;
- `estimated`: aus einem nahen Vergleichspunkt berechnet oder durch partielle Erzeugerfehler eingeschränkt;
- `unavailable`: Quelle oder notwendige Vergleichsbasis fehlt.

Fehlende Daten werden nie als Nullwert und nie als grüner Zustand ausgegeben.

## 24-Stunden-Wachstum

Der aktuelle UTC-Stundenbucket wird mit dem nächsten historischen Bucket um `T − 24 h` verglichen.

- Exakter Stundenbucket: `observed`.
- Nächster Bucket innerhalb von drei Stunden: `estimated`.
- Keine geeignete Basis: `unavailable`.

Damit wird keine Scheingenauigkeit erzeugt, wenn der stündliche Timer verspätet lief.

## Schwellenmeldungen

Die Quellinventare liefern klassifizierte Zustände für Dateisystem, temporären Gesamtbestand und Erzeugerbudgets. Leitstand speichert den letzten Zustand pro Signal.

Eine Meldung entsteht nur bei:

- Übergang in `notice`, `warning`, `hard_limit`, `critical` oder `degraded`;
- einmaliger Rückkehr eines zuvor alarmierenden Signals nach `ok`.

Ein wiederholter Lauf mit unverändertem Zustand erzeugt keine weitere Meldung. Die Meldungs-ID ist an Signal, Vorzustand, Folgezustand und Beobachtungszeit gebunden.

## Cleanup-Blocker

Der Wartungsplan wird nicht als Löschauftrag interpretiert. Die Projektion zeigt:

- unvollständige Prozessbeobachtung;
- Kandidaten ohne `automatic_cleanup_authorized=true`;
- Sicherheitsausnahmen je Wartungsklasse;
- einen expliziten `unavailable`-Blocker, wenn kein Wartungsplan geliefert wurde.

## Laufzeit-Collector

`scripts/collect-storage-health-runtime` ist die hostnahe Bridge. Sie:

- verwendet einen nicht blockierenden `flock`, damit nie zwei Läufe gleichzeitig schreiben;
- erzeugt Inventar und `plan --no-write` in einem privaten State-Root;
- verschiebt den Wartungsplan atomar;
- ruft den releasegebundenen Snapshot-Collector auf;
- schreibt das Ergebnis nach `artifacts/storage-health.json`.

Standardpfade:

```text
Heim-PC Quelle:       /home/alex/repos/heim-pc
Leitstand-Artefakte:  /home/alex/repos/leitstand/artifacts
Collector-State:      ~/.local/state/leitstand/storage-health
```

## systemd-Installation

Die Vorlagen unter `deploy/systemd/` enthalten `@…@`-Platzhalter. Die Installation wird an den exakten gebauten Leitstand-Release gebunden:

```bash
node scripts/install-storage-health-units.mjs \
  --release-root /home/alex/.local/lib/leitstand/releases/<MERGE_COMMIT>
systemctl --user daemon-reload
systemctl --user enable --now leitstand-storage-health.timer
systemctl --user start leitstand-storage-health.service
```

Der Installer schreibt nur die Unit-Dateien und gibt einen Hashbeleg aus. Er ruft `systemctl` nicht selbst auf. Aktivierung und erster Lauf bleiben getrennte, prüfbare Effekte.

Der Timer läuft stündlich, ist persistent und darf um bis zu fünf Minuten verzögert werden. Diese Verzögerung wird durch die `estimated`-Semantik des 24-Stunden-Vergleichs abgebildet.

## Live-Abnahme

Nach einem Release sind mindestens folgende Readbacks nötig:

1. `leitstand-storage-health.timer` ist aktiviert und wartet auf den nächsten Lauf.
2. `leitstand-storage-health.service` endet erfolgreich.
3. `artifacts/storage-health.json` ist ein reguläres Artefakt mit gebundenen Fenstergrößen.
4. `/storage-health` liefert HTTP 200 und zeigt `source_kind=artifact`.
5. Ein zweiter Lauf innerhalb derselben Stunde erhöht `hourly.length` nicht.
6. Ein unveränderter Schwellenzustand erhöht `notifications.length` nicht.
7. Leitstand und die bestehende `/health`-Route bleiben gesund.

## Sicherheitsfolgen

Gilt, wenn die Heim-PC-Producer read-only beziehungsweise `--no-write` bleiben und die systemd-Unit auf einen unveränderlichen Releasepfad zeigt.

Trade-off: Eine Stunde ist für Kapazitätstrends ausreichend, aber nicht für sekundengenaue Incident-Erkennung. Eine höhere Frequenz würde mehr Scanlast und mehr Prozessbeobachtungsrauschen erzeugen, ohne die Speicher-Lifecycle-Entscheidung wesentlich zu verbessern.
