---
id: docs.architecture.feature-classification
title: Feature Classification
doc_type: architecture
status: active
canonicality: informational
summary: >
  Ordnet die primären Systemblöcke von Leitstand ihren architektonischen Kernrollen zu.
---

# Feature Classification

Diese Tabelle ordnet die primären Systemblöcke von Leitstand ihren architektonischen Kernrollen zu, um Mehrfachrollen zu vermeiden und den Beobachtungszweck zu sichern.

| Bereich                 | Primärrolle | Sekundäre Aspekte                                              | Begründung                                                                 |
| ----------------------- | ----------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Digest                  | SUMMARIZE   |                                                                | Verdichtung von Daten aus verschiedenen Quellen.                           |
| Views (EJS)             | VISUALIZE   |                                                                | Reine Darstellung von Daten; keine funktionale Logik.                      |
| server.ts               | OBSERVE     | lokale Darstellungs-/Pipeline-Vorbereitung                     | Primär OBSERVE; liefert lokale Artifact-/Cache-Mechanik zur Darstellungsvorbereitung. |
| metrics/insights/events | OBSERVE     |                                                                | Reine Datenaufnahme aus Systemstreams und Metriken.                        |
| ops viewer              | VISUALIZE   |                                                                | Nur Anzeige operationaler Zustände, mutierende Absichten verbleiben extern.|
