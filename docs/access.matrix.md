---
id: docs.access.matrix
title: Zugriffsmatrix
doc_type: reference
status: active
canonicality: canonical
summary: >
  Defines the allowed access paths to the Leitstand.
---
# Zugriffsmatrix

Diese Tabelle definiert die erlaubten Zugriffswege auf den Leitstand.

| Herkunft | Ziel | Status | Erwartung |
| :--- | :--- | :--- | :--- |
| **LAN** | `https://leitstand.heimgewebe.home.arpa` | ✅ Erlaubt | HTTP 200 (Login) |
| **WireGuard** | `https://leitstand.heimgewebe.home.arpa` | ✅ Erlaubt | HTTP 200 (Login) |
| **Internet** | *Alle Adressen* | ⛔️ Blockiert | Kein Zugriff (Ingress/Firewall-Policy außerhalb dieses Repos) |
| **Docker-Netz** | `http://leitstand:3000` | ⚠️ Intern | Nur Proxy-Zugriff |

**Hinweis:**
Der Leitstand ist ein **nicht-öffentlicher** Dienst. Es gibt keine unterstützte Ausnahme für den direkten Internetzugriff.
