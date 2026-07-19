---
id: docs.drift.signals
title: Drift-Signale
doc_type: reference
status: active
canonicality: canonical
summary: >
  Observable runtime and deployment drift signals.
---

# Drift-Signale

Prüfe zuerst den [Runtime Contract](runtime.contract.md), damit erwartete Route, Release-Identität und Frischegrenzen feststehen.

| Signal | Gewichtete Deutung | Nächster Beleg |
| --- | --- | --- |
| `/health` 503 | erforderlicher Snapshot fehlt, ist ungültig oder hat den falschen Contract | betroffenen Snapshot-Eintrag und Producer-Receipt prüfen |
| `/health` 200 mit `warn` | mindestens eine Quelle ist veraltet oder zeitlich unklar | `age_seconds`, `stale_after_seconds` und Producer-Lauf prüfen |
| Git-Head abweichend | falscher Release läuft | Release-Pfad, Unit/Image und Rollout-Receipt prüfen |
| HTTP 502 | Upstream-Prozess oder Listener nicht erreichbar | Prozess, Listener-Eigentümer und Proxy-Upstream prüfen |
| DNS NXDOMAIN | interner Name wird nicht aufgelöst | autoritativen DNS-Pfad prüfen |
| Zertifikatsfehler | Trust- oder Zertifikatsdrift | Zertifikatskette und Trust Store prüfen |
| entfernte Route liefert 2xx/3xx | Altfläche wurde unbeabsichtigt reaktiviert | Release-Diff und Server-Routen prüfen |
| Runtime-Route erscheint im statischen Preview | Boundary-Vertrag verletzt | `_static-boundary.json` und Build-Ausgabe prüfen |

Ein einzelnes Signal beweist nicht automatisch die Ursache. Erst Prozess-, Git-, Datei- und Ingressbelege gemeinsam erlauben eine belastbare Diagnose.
