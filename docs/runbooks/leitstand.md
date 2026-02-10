# Leitstand Runbook

## Inputs and Data Flow

Der Leitstand aggregiert Daten aus mehreren Quellen zu einem einheitlichen Dashboard.

1. Knowledge Observatory
	•	Quelle: SemantAH (knowledge.observatory.json)
	•	Ingest: Plexer Event (knowledge.observatory.published.v1) → scripts/fetch-observatory.mjs
	•	Validierung: Striktes AJV gegen
vendor/contracts/knowledge/observatory.schema.json
(vendored Snapshot aus dem Metarepo – SSOT)
	•	Schema-Ref-Härtung:
Externe $ref sind host-allowlisted.
Konfiguration über OBSERVATORY_SCHEMA_REF_ALLOWED_HOSTS
(comma-separated, Default: schemas.heimgewebe.org)

2. System Integrity
	•	Quelle: Chronik / WGX
(artifacts/integrity/*.summary.json)
	•	Ingest: Pro-Repo-Fetch via scripts/fetch-integrity.mjs

3. Plexer Delivery Reports
	•	Quelle: Plexer (plexer.delivery.report.json)
	•	Ingest: Plexer Event (plexer.delivery.report.v1) → direkter Persist in src/server.ts
	•	Validierung: Striktes AJV gegen
vendor/contracts/plexer/delivery.report.v1.schema.json
	•	Visualisierung: Plexer Delivery Status Panel im Leitstand

⸻

## Contract Vendoring (Maintenance)

Contracts werden manuell aus dem heimgewebe/metarepo synchronisiert, um die Single Source of Truth (SSOT) zu garantieren.

Befehl:

```bash
pnpm vendor:contracts
```

	•	Aktualisiert und pinnt Schemas in vendor/contracts/
	•	Versionierung in vendor/contracts/_pin.json
	•	Alle vendored Dateien müssen committed werden
	•	Der Build führt keine Netzwerkzugriffe für Contracts aus

⸻

## Alerts and Monitoring

Plexer Delivery Status
	•	Green (OK): failed == 0
	•	Amber (BUSY): pending > 10
	•	Red (FAIL): failed > 0
Aktion:
	•	docker logs plexer
	•	last_error im Leitstand prüfen
Typische Ursachen:
Downstream-Service nicht erreichbar, Auth-Fehler

System Integrity
	•	Red (FAIL / GAP): Schemafehler oder Zeitlücken
	•	Gray (MISSING): Repo definiert, aber kein Integrity-Artefakt
Aktion: fetch-integrity Logs prüfen

⸻

## Deployment & Zugriff

Der Leitstand ist secure by default.
Er bindet niemals implizit auf alle Interfaces.

⚠️ Sicherheitsgrundsatz

Das explizite Binden an 0.0.0.0 ist nicht empfohlen.
Bevorzuge:
	•	Reverse Proxy (Caddy) im Docker-Netzwerk oder
	•	explizite Bindung an eine konkrete LAN-IP

⸻

### Deployment-Modi

#### 1. Proxy-first (Empfohlen)

Der Leitstand läuft isoliert im Docker-Netzwerk und ist nur über einen Reverse Proxy erreichbar.
Es werden keine Ports auf dem Host veröffentlicht.

Voraussetzungen:
	•	Externes Docker-Netzwerk existiert (z. B. heimnet)
	•	Reverse Proxy (z. B. Caddy) ist im selben Netzwerk

Setup (einmalig):

```bash
docker network create heimnet
```

Start / Update:

```bash
./scripts/leitstand-up --proxy
```

Verifikation:

```bash
ss -lntp | grep 3000   # muss leer sein
```

Zugriff erfolgt ausschließlich über den Proxy (z. B. `https://leitstand.heimnetz`).

⸻

#### 2. Loopback-Publish (Default / Fallback)

Für lokale Entwicklung oder Debugging direkt auf dem Server.
	•	Bindung nur an 127.0.0.1
	•	Kein LAN- oder WAN-Zugriff

Start / Update:

```bash
./scripts/leitstand-up
```

Zugriff:

```bash
http://127.0.0.1:3000/
```


⸻

#### 3. LAN-Publish (Optional)

Für Zugriff aus dem Heimnetz (z. B. iPad / Blink), ohne Reverse Proxy.

Standard (sicher):

```bash
./scripts/leitstand-up --lan
```

→ bindet weiterhin nur an 127.0.0.1

Explizite LAN-IP:

```bash
LEITSTAND_BIND_IP=192.168.178.10 ./scripts/leitstand-up --lan
```

⚠️ Warnung

Nur verwenden, wenn Firewall / NAT den Zugriff von außen blockiert.
Dies ist eine bewusste Abweichung vom Secure-by-Default-Modus.

⸻

## Update & Redeploy (Standard-Workflow)

Einziger empfohlener Einstiegspunkt:

❌ Nicht empfohlen: Manuelles `docker compose up/down`

✅ Standard:

```bash
./scripts/leitstand-up
```

Das Skript kapselt konsistent:
	•	git pull
	•	Image-Build
	•	Container-Restart
	•	korrekte Compose-Kombination je nach Modus

Zusammenfassung:

| Zweck | Befehl |
|-------|--------|
| Proxy-Betrieb | `./scripts/leitstand-up --proxy` |
| Lokal (Loopback) | `./scripts/leitstand-up` |
| LAN-Zugriff | `./scripts/leitstand-up --lan` |


⸻

## Nützliche Diagnose-Befehle

```bash
docker compose ps
docker compose logs -f
docker compose down
```

(Nur bei Bedarf — im Normalbetrieb nicht erforderlich.)

⸻

## Verdichtete Essenz

- Ein Einstiegspunkt: `leitstand-up`
- Secure by default
- Proxy-first Architektur
- Kein implizites `0.0.0.0`
- Keine manuellen Docker-Rituale nötig

Der Leitstand ist damit betriebsfähig, erklärbar und wartbar — auch in sechs Monaten.