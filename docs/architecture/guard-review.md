---
id: docs.architecture.guard-review
title: Guard Review
doc_type: architecture
status: active
canonicality: informational
summary: >
  Bewertet die existierenden Guards des Heimgewebe-Ökosystems im Kontext von Leitstand.
---

# Guard Review

Dieses Dokument bewertet die existierenden Guards des Heimgewebe-Ökosystems im Kontext von Leitstand. 
Es dient der Einordnung, welche Guards leitstand-intern bleiben sollten und welche auf Systemebene verlagert werden könnten. 
Es handelt sich hierbei um eine **Bewertung, nicht um eine Vorentscheidung**.

| Guard                  | Zweck                                   | Gehört zu | Entscheidung                                  |
| ---------------------- | --------------------------------------- | --------- | --------------------------------------------- |
| repo-structure-guard   | Prüft die Korrektheit der Ordner        | Leitstand | repo-lokal sinnvoll                           |
| docs-relations-guard   | Prüft Dokumentreferenzen                | Leitstand | repo-lokal sinnvoll                           |
| generated-files-guard  | Verhindert händisches Editieren         | Leitstand | repo-lokal sinnvoll                           |
| check-drift-gates      | Prüft systemweit konsistente Versionen  | System    | vermutlich systemweit / Auslagerung prüfen    |
| lint / test            | Statische Codeanalyse / Tests           | Leitstand | repo-lokal sinnvoll                           |
