# Drift-Signale

Typische Indikatoren für Fehler in der Betriebskonfiguration (Drift).

| Fehlercode | Bedeutung | Ursache (Typisch) |
| :--- | :--- | :--- |
| **HTTP 404** | Nicht gefunden | Falscher Hostname / Reverse Proxy Match fehlgeschlagen (Drift: DNS/Proxy Config) |
| **Zertifikatswarnung** | SSL/TLS Fehler | Caddy Internal CA nicht im Trust Store (Drift: Zertifikat nicht erneuert/installiert) |
| **DNS NXDOMAIN** | Name nicht aufgelöst | DNS-Server (Pi-hole) nicht autoritativ für `*.heimgewebe.home.arpa` (Drift: DNS Config) |
| **HTTP 502** | Bad Gateway | Reverse Proxy Upstream (`leitstand:3000`) nicht erreichbar (Drift: Container abgestürzt/nicht gestartet) |
| **Mixed Content** | Blockiert | HTTPS Leitstand lädt HTTP Inhalte (Drift: ACS URL nicht HTTPS) |

## Handlungsempfehlung

1. **Contract prüfen:** Prüfe zuerst die Konfiguration anhand von `docs/runtime.contract.md`.
2. **Ingress prüfen:** Wenn der Contract erfüllt ist, prüfe das Heimserver-Runbook / Ingress-Konfiguration außerhalb dieses Repos (Firewall, DNS, Proxy).
