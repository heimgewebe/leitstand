# Leitstand Runbook

## Inputs and Data Flow

Leitstand aggregates data from multiple sources to provide a unified dashboard.

### 1. Knowledge Observatory
- **Source:** SemantAH (`knowledge.observatory.json`)
- **Ingest:** Via Plexer Event (`knowledge.observatory.published.v1`) -> `scripts/fetch-observatory.mjs`
- **Validation:** Strict AJV against `vendor/contracts/knowledge/observatory.schema.json` (Vendored snapshot from metarepo SSOT)
  - **Schema Ref Hardening:** `OBSERVATORY_SCHEMA_REF` is allowlisted by host. Configure via `OBSERVATORY_SCHEMA_REF_ALLOWED_HOSTS` (comma-separated). Default: `schemas.heimgewebe.org`.

### 2. System Integrity
- **Source:** Chronik/WGX (`artifacts/integrity/*.summary.json`)
- **Ingest:** Per-repo artifacts fetched via `scripts/fetch-integrity.mjs`

### 3. Plexer Delivery Reports
- **Source:** Plexer (`plexer.delivery.report.json`)
- **Ingest:** Via Plexer Event (`plexer.delivery.report.v1`) -> `src/server.ts` direct save
- **Validation:** Strict AJV against `vendor/contracts/plexer/delivery.report.v1.schema.json`
- **Visualization:** "Plexer Delivery Status" panel in Observatory.

## Contract Vendoring (Maintenance)

Contracts are synchronized from the `heimgewebe/metarepo` to ensure Single Source of Truth (SSOT).
This process is **manual** and should be run whenever contracts are updated in the metarepo.

**Command:**
```bash
pnpm vendor:contracts
```
This script fetches canonical schemas and pins them in `vendor/contracts/_pin.json`.
The vendored files must be committed to the repository. The build process (`build:cf`) relies on these local files and does **not** perform network requests to fetch contracts.

## Alerts and Monitoring

### Plexer Delivery Status
- **Green (OK):** `failed == 0`
- **Amber (BUSY):** `pending > 10`
- **Red (FAIL):** `failed > 0`
  - Action: Check Plexer logs (`docker logs plexer`) or `last_error` in Leitstand.
  - Likely causes: Downstream service (Heimgeist/Chronik) unreachable or Auth failures.

### System Integrity
- **Red (FAIL/GAP):** Schema violations or timestamp gaps in repo feeds.
- **Gray (MISSING):** Repository defined in Metrics but no Integrity artifact found.
  - Action: Check `fetch-integrity` logs.

## Deployment & Zugriff

Der Leitstand unterstützt verschiedene Deployment-Modi, je nach Sicherheitsanforderung und Netzwerktopologie.

> ⚠️ **Sicherheitswarnung: Port-Bindings**
>
> Der Leitstand bindet standardmäßig **niemals** auf `0.0.0.0` (alle Interfaces).
> Das explizite Binden an `0.0.0.0` ist sicherheitstechnisch bedenklich und sollte vermieden werden.
> Nutzen Sie stattdessen einen Reverse Proxy (Caddy) im Docker-Netzwerk oder binden Sie an eine spezifische LAN-IP.

### 1. Proxy-first (Empfohlen)
Der Leitstand wird isoliert im Docker-Netzwerk betrieben und ist nur über einen Reverse Proxy (Gateway) erreichbar. Es werden **keine Ports** auf dem Host veröffentlicht.

**Voraussetzungen:**
- Ein externes Docker-Netzwerk (z.B. `heimnet`) existiert.
- Ein Reverse Proxy (z.B. Caddy) ist in diesem Netzwerk.

**Start:**
1. Netzwerk sicherstellen:
   ```bash
   docker network create heimnet || true
   ```
2. Starten (via Skript):
   ```bash
   ./scripts/leitstand-deploy --proxy
   ```
3. Verifikation:
   - Prüfen, dass kein Port 3000 auf dem Host lauscht: `ss -lntp | grep 3000` (sollte leer sein).
   - Zugriff via Gateway testen (z.B. `curl https://leitstand.heimnetz`).

### 2. Loopback-Publish (Fallback / Default)
Für lokale Entwicklung oder Debugging direkt auf dem Host.
Der Port `3000` wird **nur an 127.0.0.1** gebunden.

**Start:**
```bash
./scripts/leitstand-deploy
```
- Zugriff: `http://127.0.0.1:3000/`

### 3. LAN-Publish (Optional)
Erlaubt den Zugriff aus dem Heimnetz (z.B. iPad/Blink), ohne Reverse Proxy.
Der Port `3000` wird standardmäßig an **127.0.0.1** gebunden, kann aber via Environment-Variable auf die LAN-IP erweitert werden.

**Start:**
```bash
# Standard (bindet an 127.0.0.1)
./scripts/leitstand-deploy --lan

# Explizite LAN-IP (bindet an 192.168.x.x)
LEITSTAND_BIND_IP=192.168.178.10 ./scripts/leitstand-deploy --lan
```

## Update & Redeploy

Für Routine-Updates und Neustarts wird **ausschließlich** das bereitgestellte Skript empfohlen. Es kapselt die notwendigen Schritte (Pull, Build, Restart) sicher und konsistent.

❌ **docker compose ist intern:** Die manuelle Nutzung von `docker compose` ist möglich, aber fehleranfällig (vergessene Parameter, Dirty State).
✅ **leitstand-deploy ist der Standard:**

### Proxy-Modus (Empfohlen)
Wenn der Leitstand hinter einem Proxy (Option 1) läuft:
```bash
./scripts/leitstand-deploy --proxy
```

### Standard (Lokal)
Aktualisiert den Code (`git pull`), baut neu und startet den Dienst (nur localhost).
```bash
./scripts/leitstand-deploy
```

### LAN-Modus
Wenn der Leitstand im lokalen Netzwerk erreichbar sein soll (entspricht Start-Option 3):
```bash
./scripts/leitstand-deploy --lan
```
