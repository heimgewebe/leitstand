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
  - Action: Check Plexer logs (`docker compose logs plexer`) or `last_error` in Leitstand.
  - Likely causes: Downstream service (Heimgeist/Chronik) unreachable or Auth failures.

### System Integrity
- **Red (FAIL/GAP):** Schema violations or timestamp gaps in repo feeds.
- **Gray (MISSING):** Repository defined in Metrics but no Integrity artifact found.
  - Action: Check `fetch-integrity` logs.

## Deployment & Zugriff

Der Leitstand wird via Docker Compose deployt und lauscht standardmäßig auf **localhost:3000** (sicherer Default).

### Standard Update & Start
Der einzige empfohlene Einstiegspunkt für Updates und Neustarts ist das `scripts/leitstand-up` Skript.

**1. Update & Start (Default: Localhost)**
```bash
./scripts/leitstand-up
```
- **Verhalten:** `git pull` -> Rebuild -> Start auf `127.0.0.1:3000`.
- **Zugriff:** `http://127.0.0.1:3000/` (oder via SSH Tunnel).

**2. LAN-Start (Optional)**
Erlaubt den Zugriff aus dem Heimnetz (z.B. iPad/Blink).
Erfordert explizites Setzen von `LEITSTAND_BIND_IP`.

```bash
export LEITSTAND_BIND_IP=<IP>
./scripts/leitstand-up --lan
```
- **Verhalten:** Bindet explizit an die angegebene IP.
- **Sicherheit:** Verhindert versehentliches Binden an `0.0.0.0`.

### Manuelle Diagnose & Logs
Falls das Start-Skript nicht ausreicht oder zur Fehlersuche:

- **Logs verfolgen:** `docker compose logs -f`
- **Container stoppen:** `docker compose down`
- **Status prüfen:** `docker compose ps`

## Troubleshooting

### Deployment
1. Wechsle in das Deploy-Verzeichnis:
   ```bash
   cd deploy
   ```
2. Überprüfe die Umgebungskonfiguration:
   ```bash
   # .env muss existieren (kopiere von .env.example)
   ls -la .env
   ```
   **Wichtig:** `deploy/.env` wird absichtlich ignoriert und darf niemals committed werden.

### Reverse Proxy
Falls ein Reverse Proxy verwendet wird (siehe `ops.runbook.leitstand-gateway.md`), stelle sicher, dass Leitstand **nicht** öffentlich (0.0.0.0) lauscht, sondern nur auf dem internen Interface, das der Proxy erreicht (z.B. localhost oder docker network).
