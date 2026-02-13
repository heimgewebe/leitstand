# Zugriffsmatrix

Diese Tabelle definiert die erlaubten Zugriffswege auf den Leitstand.

| Herkunft | Ziel | Status | Erwartung |
| :--- | :--- | :--- | :--- |
| **LAN** | `https://leitstand.heimgewebe.home.arpa` | ✅ Erlaubt | HTTP 200 (Login) |
| **WireGuard** | `https://leitstand.heimgewebe.home.arpa` | ✅ Erlaubt | HTTP 200 (Login) |
| **Internet** | *Alle Adressen* | ⛔️ Blockiert | Kein Zugriff (Drop/Reject) |
| **Docker-Netz** | `http://leitstand:3000` | ⚠️ Intern | Nur Proxy-Zugriff |

**Hinweis:**
Der Leitstand ist ein **nicht-öffentlicher** Dienst. Es gibt keine Ausnahmen für den direkten Internetzugriff.
