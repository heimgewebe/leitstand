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

Der Leitstand wird via Docker Compose deployt und lauscht standardmäßig auf **localhost:3000** (sicherer Default).

### Deployment
1. Wechsle in das Deploy-Verzeichnis:
   ```bash
   cd deploy
   ```
2. Erstelle die Umgebungskonfiguration (falls nicht vorhanden):
   ```bash
   cp .env.example .env
   # Editiere .env nach Bedarf (z.B. LEITSTAND_ACS_URL)
   ```
   **Wichtig:** `deploy/.env` wird absichtlich ignoriert und darf niemals committed werden.

### Start-Optionen

#### A) Lokaler Start (Default)
Nur auf dem Heimserver selbst (oder via SSH Portforwarding) erreichbar.
```bash
docker compose up -d --build
```
- **Zugriff:** `http://127.0.0.1:3000/`

#### B) LAN-Start (Optional)
Erlaubt den Zugriff aus dem Heimnetz (z.B. iPad/Blink).
```bash
docker compose -f docker-compose.yml -f docker-compose.lan.yml up -d --build
```
- **Zugriff:** `http://<heimserver-lan-ip>:3000/`

**Option: Binden an eine spezifische IP**
Um nicht auf `0.0.0.0` (alle Interfaces) zu lauschen, setze `LEITSTAND_BIND_IP`:
```bash
LEITSTAND_BIND_IP=192.168.178.10 docker compose -f docker-compose.yml -f docker-compose.lan.yml up -d --build
```

**Warnung:**
Diese Option bindet an `0.0.0.0` (alle Interfaces), sofern nicht anders angegeben. Nutze dies nur, wenn deine Firewall/NAT den Zugriff von außen blockiert.
Falls Blink (iPad) keinen stabilen SSH-Tunnel unterstützt, ist dies die empfohlene Methode.
Alternativ: Reverse Proxy (siehe `ops.runbook.leitstand-gateway.md`).

## Update & Redeploy

Für Routine-Updates und Neustarts wird **ausschließlich** das bereitgestellte Skript empfohlen. Es kapselt die notwendigen Schritte (Pull, Build, Restart) sicher und konsistent.

❌ **docker compose ist intern:** Die manuelle Nutzung von `docker compose` ist möglich, aber fehleranfällig (vergessene Parameter, Dirty State).
✅ **leitstand-deploy ist der Standard:**

### Standard (Lokal)
Aktualisiert den Code (`git pull`), baut neu und startet den Dienst (nur localhost).
```bash
./scripts/leitstand-deploy
```

### LAN-Modus
Wenn der Leitstand im lokalen Netzwerk erreichbar sein soll (entspricht Start-Option B):
```bash
./scripts/leitstand-deploy --lan
```
