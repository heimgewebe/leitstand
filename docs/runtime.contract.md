# Runtime Contract

Dieses Dokument beschreibt die unveränderlichen Bedingungen für den Betrieb des Leitstands.

## 1. Scope / Phase

Aktuell läuft das Deployment auf dem Heimserver nur während der Entwicklungs-/Integrationsphase. Der hier definierte Contract (FQDN, intern-only, Proxy/Host-Match) bleibt davon unberührt und gilt normativ.

## 2. Kanonischer Host

Der Leitstand ist ausschließlich unter folgendem FQDN erreichbar:

**`leitstand.heimgewebe.home.arpa`**

## 3. Erwartete Erreichbarkeit

- **Protokoll:** HTTPS only (kein HTTP, außer Redirect)
- **TLS:** Internal CA (Caddy)
- **Proxy:** Reverse Proxy via Caddy (kein direkter Container-Zugriff)
- **Upstream:** `leitstand:3000` (Docker DNS)

## 4. Health-Kriterien

Der Dienst gilt als gesund ("grün"), wenn:

- **HTTP Status:** 200 OK auf `/` und `/health`
- **Host:** Kein Mixed Content (HTTPS-Only Policy)
- **Zugriff:** Direkter IP-Zugriff ist nicht Teil des Contracts; Zugriff erfolgt per FQDN Host-Match via Reverse Proxy.

## 5. Deployment-Status

Leitstand ist korrekt deployed, wenn:
- DNS A-Record auf den Entry-Proxy zeigt.
- TLS CN exakt dem FQDN entspricht.
- Reverse Proxy Host-Match korrekt ist.

## 6. Dokumentationskonvention (non-normative)

Da dieses Repository öffentlich ist, werden für interne Infrastruktur-Details generische Platzhalter verwendet. Dieser Abschnitt ist nicht Teil des Runtime Contracts.

| Platzhalter | Bedeutung | Beispielwert (Generisch) |
| :--- | :--- | :--- |
| `<IP>` | Eine konkrete IPv4 Adresse im LAN | `192.168.0.10` |
| `<GATEWAY_IP>` | Die IP des Entry-Gateways / Reverse Proxy | `192.168.0.5` |
| `<DNS_SERVER_IP>` | Der lokale DNS-Resolver (z.B. Pi-hole) | `192.168.0.2` |
| `<LAN_SUBNET>` | Das vertrauenswürdige Heimnetz-Segment | `192.168.0.0/24` |
| `<WG_SUBNET>` | Das WireGuard VPN-Segment | `10.8.0.0/24` |
| `<UPSTREAM>` | Der Upstream-Service (Container) | `leitstand` |

**Hinweis:** Die realen Werte sind im privaten Heimserver-Runbook hinterlegt.
