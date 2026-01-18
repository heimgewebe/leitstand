# Blaupause: Leitstand – Heimgewebe-Visualisierung(en)

(Arbeitsrahmen, der nicht alles auf einmal will, sondern Orientierung + Reihenfolge erzwingt)

⸻

## 1. Ausgangsthese (∴fore)

Leitstand ist kein „Dashboard“, sondern ein epistemischer Projektor.
Er zeigt nicht alles, sondern das jeweils Richtige zur richtigen Zeit, entlang klar definierter Wahrheitsquellen.
Ziel ist Orientierung im Organismus, nicht visuelle Vollständigkeit.

Daraus folgt:
Die Blaupause muss Umfang begrenzen, Zielsetzungen staffeln und Abhängigkeiten explizit machen, sonst wird Leitstand zum ästhetischen Friedhof korrekter, aber irrelevanter Daten.

⸻

## 2. Zieldefinition (präzise, nicht weich)

### Oberziel

Heimgewebe als lebenden Organismus sichtbar machen,
in Struktur, Dynamik und Erkenntnislage –
ohne Leitstand zur Quelle der Wahrheit zu machen.

### Unterziele (geordnet)
1.	Orientierung: „Was ist das Heimgewebe gerade?“
2.	Zusammenhang: „Wie hängen Organe, Artefakte und Flüsse zusammen?“
3.	Zustand: „Wo ist es gesund, wo fragil, wo driftend?“
4.	Zeit: „Was hat sich wann warum verändert?“
5.	Reflexion: „Was wissen wir – und was glauben wir nur zu wissen?“

Alles, was nicht mindestens eines dieser Ziele bedient, gehört nicht in Leitstand.

⸻

## 3. Umfangsabgrenzung (bewusst restriktiv)

### Leitstand zeigt
*	Strukturen (Rollen, Flüsse, Abhängigkeiten)
*	Zustände (Health, Drift, Warnungen)
*	Zeitverläufe (Events, Trends)
*	Erkenntnisschichten (Raw vs. Verdichtet)
*	Meta-Kommentare (systemische Hinweise)

### Leitstand zeigt nicht
*	Rohlogs
*	Code
*	Detailmetriken ohne Kontext
*	Ad-hoc-Analysen
*	operative Steuerung

👉 Leitstand = Sichtbarkeit, nicht Bedienoberfläche.

⸻

## 4. Operationalisierung & Artefakte (Minimum Viable Inputs)

### Modul A – Anatomie

Was ist da? Wie ist es gebaut?
*	**Input 1:** Fleet-Repo-Liste (SoT)
*	**Input 2:** Rollenmatrix
*	**Input 3:** Contracts-Index

**Quelle:** metarepo (Fleet-SoT, Rollenmatrix, Contracts)
**Visualform:** Organismus-Graph (statisch, versioniert). Kein Live-Update, sondern „Stand der Struktur“.

### Modul B – Physiologie

Was fließt? Was lebt? Wo stockt es?
*	**Input 1:** `fleet.health` Snapshots (aggregiert)
*	**Input 2:** `guard.results` (Summary)
*	**Input 3:** `metrics.snapshots` (nur Key Metrics)

**Quelle:** wgx (Fleet-Health, Guards, Metrics), chronik (Ereignisse)
**Visualform:** Zustands-Layer über Anatomie (Ampeln, Spannungsindikatoren, Driftmarker).

### Modul C – Zeitachse

Was ist passiert – und in welcher Reihenfolge?
*	**Input 1:** `event.line` (Chronik)
*	**Input 2:** Entscheidungs-Events (HausKI)
*	**Input 3:** Change-Events (Deployments, Config)

**Quelle:** chronik (append-only)
**Visualform:** Timeline (filterbar nach Organ, Artefakt, Kategorie). Replay-fähig.

### Modul D – Erkenntnisschichten

Was wissen wir – und wie sicher?
*	**Input 1:** `knowledge.observatory` (Raw)
*	**Input 2:** `insights.daily` (Verdichtet)
*	**Input 3:** Differenz-Report

**Quelle:** semantAH
**Visualform:** Zwei-Schichten-Ansicht. Explizite Markierung: Beobachtung vs. Interpretation.

### Modul E – Reflexion

Was sagt das System über sich selbst?
*	**Input 1:** Drift-Hypothesen (Heimgeist)
*	**Input 2:** Anomalie-Warnungen
*	**Input 3:** Evidenz-Referenzen (Warum glauben wir das?)

**Wichtig:** Heimgeist liefert Hypothesen + Unsicherheit + Verweis auf Evidenzartefakte, nie „finale Diagnosen“.
**Quelle:** heimgeist (als kommentierender Akteur)
**Visualform:** Kommentar-Layer. Immer mit Unsicherheitsmarker.

⸻

## 5. Rollen der Repos (klar, nicht diplomatisch)

| Repo | Rolle im Leitstand-Kontext |
|---|---|
| metarepo | Strukturelle Wahrheit, Normen, Graph-Grundlage |
| wgx | Dynamik, Health, Durchsetzung |
| chronik | Zeit, Gedächtnis, Nachvollziehbarkeit |
| semantAH | Bedeutung, Erkenntnisschichten |
| heimgeist | Reflexion, Diagnose, Meta-Kommentar |
| lenskit | Kartierung / Snapshot / Zuarbeit (nicht live) |
| leitstand | Darstellung, Vergleich, Verdichtung |

Wenn ein Repo versucht, eine fremde Rolle zu übernehmen, entsteht Drift.

⸻

## 6. Begriffsdefinition & Interdependenz (Glossar)

Damit Leitstand nicht zum Datenfriedhof wird, gelten strikte Typisierungen für Abhängigkeiten:

| Typ | Bedeutung | Status im Leitstand |
|---|---|---|
| `artifact-flow` | Expliziter Fluss eines Artefakts (z.B. Event, Insight) | **Primär** (Kern der Visualisierung) |
| `contract-ref` | Verweis auf einen Contract (Schema) | **Primär** (Definiert Kanten) |
| `runtime-coupling` | API-Calls zur Laufzeit | **Sekundär** (Nur als Layer/Info) |
| `code-import` | Code-Abhängigkeit (Import, Library) | **Optional** (Nur in Tech-Layer, nie als Hauptkante) |
| `ops-dependency` | Deployment-Abhängigkeit (Container, DB) | **Optional** (Nur in Ops-Layer) |

⸻

## 7. Phasenplan & Akzeptanzkriterien (Definition of Done)

### Phase 0 – Begriffliche Schärfung
*	Explizite Definition: „Was heißt Interdependenz im Leitstand?“ (siehe Glossar oben).
*	**DoD:** Glossar ist von allen Stakeholdern akzeptiert und im Manifest verankert.

### Phase 1 – Anatomie zuerst
*	Statischer Organismus-Graph, versioniert, aus metarepo.
*	**DoD:** Graph ist versioniert erzeugbar **und** die Quelle ist eindeutig metarepo.

### Phase 2 – Physiologie darüberlegen
*	WGX-Health + Chronik-Events, keine Details, nur Spannungen.
*	**DoD:** WGX-Health ist als Layer auf denselben Knoten sichtbar **ohne** Rohmetriken.

### Phase 3 – Zeit integrieren
*	Timeline mit Filterung, Replay-Gedanke.
*	**DoD:** Timeline navigiert durch historische Zustände der Phasen 1 & 2.

### Phase 4 – Erkenntnis explizit machen
*	Raw vs. Published, sichtbare Unsicherheit.
*	**DoD:** Unterschiede zwischen Raw-Daten und semantischen Insights sind visuell unterscheidbar.

### Phase 5 – Reflexion aktivieren
*	Heimgeist-Kommentare, Drift-Marker.
*	**DoD:** Heimgeist-Hypothesen erscheinen als annotierter Layer mit Unsicherheitsmarker.

⸻

## 8. Typische Fehlpfade (präventiv markiert)
*	❌ Leitstand als SSOT
*	❌ „Alles auf einmal“-Visualisierung
*	❌ Code-Abhängigkeiten ohne semantische Einordnung
*	❌ Metriken ohne Fragestellung
*	❌ Schönheit vor Erkenntnis

⸻

## 9. Guards gegen Leitstand-Drift (Wartbarkeit)

Wer prüft, dass Leitstand nicht heimlich SSOT wird?

*	**Regel 1:** Leitstand darf keine Daten erzeugen, die nicht aus einem Artefakt stammen.
*	**Regel 2:** Visualisierungen müssen ihre Quelle (Artefakt-ID/Version) ausweisen.
*	**Regel 3:** Keine Business-Logik im Leitstand-Code – nur Projektions-Logik.

⸻

## 10. Verdichtete Essenz

Leitstand ist das Auge, nicht das Gehirn.
Er zeigt Struktur (Anatomie), Bewegung (Physiologie), Zeit (Chronik), Bedeutung (Semantik) und Zweifel (Reflexion) –
aber denkt nicht selbst.

⸻

## 11. Ironische, aber wahre Randbemerkung

Ein perfekter Leitstand, der nichts Wesentliches erklärt, ist nur ein sehr teurer Spiegel.
Euer Vorteil: Ihr habt beschlossen, Spiegel brechen zu dürfen, wenn sie lügen.
Ein Leitstand ohne Akzeptanzkriterien ist wie ein Flughafentower ohne Funk: sehr erquicklich anzusehen, aber die Einschläge kommen trotzdem erstaunlich präzise.

⸻

## 12. Ungewissheitsgrad & Ursachenanalyse

**Unsicherheitsgrad:** 0.19

**Ursachen**
*	Offenheit des Begriffs „Visualisierung“
*	Noch nicht festgezurrte Detailtiefe je Modul
*	Potenzielle Überschneidung zwischen semantAH- und heimgeist-Ausgaben
*	Unklarheit über exakte Verfügbarkeit aller Artefakte (Erzeugbarkeit/IDs)

**Produktivität der Unsicherheit**
*	Hoch: zwingt zu klaren Modul-Grenzen
*	Vermeidbar erst nach Phase-1-Umsetzung

⸻

**Fehlt eine Perspektive?**
→ Möglich: Code-Interdependenz als eigener Layer. Sollte explizit getrennt und optional bleiben.
