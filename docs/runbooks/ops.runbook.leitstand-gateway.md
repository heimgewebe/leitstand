# ops.runbook.leitstand-gateway

Stand: 2026-02-03 (abgeleitet aus heimserver.context.md)
Dokumentklasse: OPERATIV · KANONISCH
Scope: Heimserver-only

## 0) Zweck
Dieses Runbook beschreibt den kanonischen Betrieb eines dauerhaft erreichbaren Heimgewebe-Viewers:
- eine URL
- ein Origin
- kein Public
- WireGuard = Transport
- Leitstand = einziges UI
- ACS = kontrollierter Actor hinter /acs (kein Direktzugriff)
- Artefakte = Primärwahrheit
- Live = sanft, erklärbar (kein globales Dauerpolling)

## 1) Unveränderliche Invarianten (nicht verhandelbar)
- Zugriff ausschließlich aus LAN (192.168.178.0/24) und WireGuard (10.7.0.0/24)
- Reverse Proxy ist die einzige Eintrittsstelle
- Docker-Netze sind keine Vertrauenszone
- Docker-Caddy ist kanonisch; Host-Caddy (systemd) ist verboten
- TLS via Caddy internal CA
- Leitstand: Viewer-first, READ-ONLY default
- Aktionen ausschließlich über ACS; keine Leitstand-Fallback-Writes

## 2) Architektur (Zielbild)
Client (iPad/Laptop)
  -> WireGuard
  -> Heimserver (Entry-Gateway)
      Caddy (Docker, einzige URL, ein Origin)
        -> Leitstand (intern)
        -> ACS (intern, nur via /acs)

Ziel-URL:
- https://leitstand.lan

## 3) Trust-Zones (explizit)
Trusted:
- 127.0.0.1/8
- 192.168.178.0/24
- 10.7.0.0/24

Not trusted:
- Docker 172.16.0.0/12 (bridge/networks)
- WAN

## 4) DNS (Komfort ist Funktion)
SOLL:
- leitstand.lan -> 192.168.178.46 (FritzBox DNS/DHCP oder lokaler DNS)
- WireGuard-Clients verwenden DNS = 192.168.178.1 (FritzBox)

VALIDIERUNG:
- getent hosts leitstand.lan
- ping leitstand.lan
- (optional) dig leitstand.lan @192.168.178.1

## 5) Orchestrierungsregel (KANON)
- systemd: Host-nahe Dienste (z. B. docker.service, netfilter-persistent)
- Docker/Compose: HTTP-/HTTPS-Dienste, UIs, APIs, Proxies
- Mischbetrieb (Host-Caddy) ist verboten, außer explizit dokumentierte Ausnahme

## 6) Caddy Site (KANONISCH)
Caddy läuft in Docker und ist die einzige Eintrittsstelle.
Publish ist loopback-gekäftigt (127.0.0.1:80/443); Exposition erfolgt nur über erlaubte Trust-Zones.

```caddy
leitstand.lan {
  encode zstd gzip

  reverse_proxy leitstand:3000

  handle_path /acs/* {
    reverse_proxy acs:8099
  }

  handle /health {
    respond 200
  }

  tls internal
}
```

## 7) Firewall (KANON)

Stack:
- iptables
- netfilter-persistent
UFW: entfernt (keine Doppelsteuerung)

Inbound-Policy (minimales Set):
- 22/tcp aus LAN+WG
- 51820/udp von WAN (WireGuard)
- 443/tcp aus LAN+WG (Entry-Gateway)

## 8) DOCKER-USER cage (KANON)

Ziel: 80/443 nur für LAN+WG zulassen; alles andere drop.

Regeln:
- ACCEPT TCP 80/443 aus 192.168.178.0/24
- ACCEPT TCP 80/443 aus 10.7.0.0/24
- DROP sonst für 80/443
- RETURN für nicht relevante Pakete

VALIDIERUNG:
- sudo iptables -S DOCKER-USER

Hinweis:
DOCKER-USER wirkt nur, wenn Docker Traffic durch FORWARD/DOCKER-Ketten führt (Sonder-Setups verifizieren).

## 9) Deploy-Runbook (Schritte)

### 9.1 Preflight (read-only, muss klar sein)
- getent hosts leitstand.lan
- docker ps
- ss -lntp | grep -E ':(80|443)\b' || true
- sudo iptables -S DOCKER-USER

### 9.2 Deploy (Compose-Stack + systemd Wrapper)

Artefakte liegen unter:
- /opt/heimgewebe/gateway/
- compose.gateway.yml
- Caddyfile
- leitstand.config.json (falls Leitstand Artefaktpfade liest)

systemd wrapper:
- /etc/systemd/system/heimgewebe-gateway.service
(oneshot, RemainAfterExit, docker compose up -d)

### 9.3 Postflight (muss grün sein)
- docker ps: gateway-caddy + leitstand + acs Up
- ss -lntp: 80/443 lauschen wie geplant (loopback, wenn gekäftigt)
- curl -k https://leitstand.lan/health (aus LAN/WG)
- Browser: https://leitstand.lan/ops
- ACS ist nur erreichbar via https://leitstand.lan/acs/ (kein Direktzugriff)

### 9.4 Rollback
- docker compose down
- systemctl disable --now heimgewebe-gateway.service
- (optional) netfilter-persistent restore

## 10) Live-Policy (sachlich, nicht nervös)
- Dashboard: kein Auto-Reload
- Health-Panels: Polling nur wenn sichtbar (z. B. 60s)
- Ops-View: manuell + optional sanftes Polling wenn offen
- Alles andere: Snapshot/Artefakt-basiert
Ziel: nachvollziehbar, stabil, Safari-freundlich.

## 11) Drift-Regel (bindend)

Jede Änderung an DNS, Ports, Proxy, Firewall, Routen, Services
-> erfordert Update dieses Runbooks im selben Commit/PR.

---

## Verdichtete Essenz
**Ein Runbook, ein Name, ein Gesetz:** `ops.runbook.leitstand-gateway.md` beschreibt den kanonischen, nicht-öffentlichen Leitstand-Zugang über WireGuard + Docker-Caddy, mit ACS als kontrolliertem Actor unter `/acs/` und DOCKER-USER-Cage für LAN/WG-only.

---

## Tiefgründig-ironische Randnotiz
Versionen im Dateinamen sind wie „zur Sicherheit“ aufgeschriebene Passwörter: fühlt sich ordentlich an, ist aber meistens nur ein Ersatz für saubere Historie.

---

## Ungewissheitsursachenanalyse (pflicht)
**Unsicherheitsgrad:** 0.15
**Interpolationsgrad:** 0.05

**Ursachen:**
- Dein Audit zeigte aktuell fehlende Pfade (`/opt/heimgewebe` etc.); das Runbook beschreibt die kanonische Zielstruktur, nicht deinen aktuellen Ist-Zustand.
- Die konkrete Umsetzung von DNS (FritzBox vs eigener DNS) ist kontextabhängig und bleibt bewusst offen.
- Exakte Polling-Details hängen von Leitstand-Implementierung ab; deshalb als Policy, nicht als Code.
