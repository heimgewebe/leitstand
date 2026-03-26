# Feature Classification

Diese Tabelle ordnet die primären Systemblöcke von Leitstand ihren architektonischen Kernrollen zu, um Mehrfachrollen zu vermeiden und den Beobachtungszweck zu sichern.

| Bereich                 | Klassifikation    | Begründung                                                                 |
| ----------------------- | ----------------- | -------------------------------------------------------------------------- |
| Digest                  | SUMMARIZE         | Verdichtung von Daten aus verschiedenen Quellen.                           |
| Views (EJS)             | VISUALIZE         | Reine Darstellung von Daten; keine funktionale Logik.                      |
| server.ts               | OBSERVE/VISUALIZE | Primär OBSERVE/VISUALIZE mit lokaler Pipeline-/Cache-/Artifact-Mechanik zur Darstellungsvorbereitung. |
| metrics/insights/events | OBSERVE           | Reine Datenaufnahme aus Systemstreams und Metriken.                        |
| ops viewer              | VISUALIZE         | Nur Anzeige operationaler Zustände, mutierende Absichten verbleiben extern.|
