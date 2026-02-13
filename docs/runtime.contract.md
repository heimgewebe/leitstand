# Runtime Contract

Dieses Dokument beschreibt die unveränderlichen Bedingungen für den Betrieb des Leitstands.

## 1. Kanonischer Host

Der Leitstand ist ausschließlich unter folgendem FQDN erreichbar:

**`leitstand.heimgewebe.home.arpa`**

## 2. Erwartete Erreichbarkeit

- **Protokoll:** HTTPS only (kein HTTP, außer Redirect)
- **TLS:** Internal CA (Caddy)
- **Proxy:** Reverse Proxy via Caddy (kein direkter Container-Zugriff)
- **Upstream:** `leitstand:3000` (Docker DNS)

## 3. Health-Kriterien

Der Dienst gilt als gesund ("grün"), wenn:

- **HTTP Status:** 200 OK auf `/` und `/health`
- **Host:** Kein Mixed Content (HTTPS-Only Policy)
- **Zugriff:** Direkter IP-Zugriff ist nicht unterstützt und sollte durch Ingress/Firewall-Policy verhindert werden.

## 4. Deployment-Status

Leitstand ist korrekt deployed, wenn:
- DNS A-Record auf den Entry-Proxy zeigt.
- TLS CN exakt dem FQDN entspricht.
- Reverse Proxy Host-Match korrekt ist.
