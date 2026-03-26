---
id: docs.architecture.non-goals
title: Explizite Nicht-Ziele (Non-Goals)
doc_type: architecture
status: active
canonicality: informational
summary: >
  Definiert, was Leitstand ausdrücklich nicht tun wird, um die Observer-Rolle zu sichern.
---

# Explizite Nicht-Ziele (Non-Goals)

Um Leitstand stabil als **Observer** im Heimgewebe-Organismus zu verankern, wird definiert, was das System *nicht* tun wird. 

Leitstand wird nicht:
* **mutierende oder orchestrierende Commands ausführen:** Leitstand führt keine Kommandos aus, die den Zustand anderer Repositories oder externer Systemdienste verändern oder steuern. Lokale read-orientierte Hilfsskripte (z. B. Fetch-Skripte für Datenabruf) sind davon ausgenommen, solange sie keinen schreibenden Einfluss auf externe Systeme haben.
* **externe Systeme mutieren:** Es gibt keine APIs oder Routinen in Leitstand, die Daten auf anderen Hosts (wie ACS oder Chronik) schreibend verändern.
* **CI/CD triggern:** Leitstand stößt keine Deployments oder Builds an.
* **Entscheidungen automatisiert treffen:** Leitstand bereitet Daten auf. Die Interpretation und Steuerung bleiben beim Operator oder bei HausKI.

Wenn Code diese Richtung andeutet, handelt es sich vermutlich um einen **Observer Boundary Bruch**. Diese Stellen müssen markiert (und perspektivisch in entsprechende Control-Subsysteme umgewandelt/ausgelagert) werden, statt sie umzubauen.
