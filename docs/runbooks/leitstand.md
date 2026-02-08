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

Der Leitstand wird via Docker Compose deployt und lauscht standardmäßig auf Port 3000 (LAN-weit).

### Deployment
1. Wechseln in das Deploy-Verzeichnis:
   ```bash
   cd deploy
   ```
2. Umgebungskonfiguration erstellen (falls nicht vorhanden):
   ```bash
   cp .env.example .env
   # Editieren Sie .env nach Bedarf (z.B. LEITSTAND_ACS_URL)
   ```
3. Starten (mit Build):
   ```bash
   docker compose up -d --build
   ```

### Zugriff im Heimnetz
- `http://<heimserver>:3000/`
- `http://<heimserver>:3000/ops`

**Hinweis:**
Der Service ist **nicht** für direkte Internet-Exposure gedacht. Falls externe Erreichbarkeit gewünscht ist, muss zwingend ein Reverse Proxy (z. B. Caddy/Gateway) mit TLS und Authentifizierung vorgeschaltet werden.

### Warum kein SSH-Tunnel?

Wir verzichten bewusst auf den Zugriff via SSH-Tunnel für den regulären Betrieb:
- **Mobile Clients:** Apps wie Blink (iPad) unterstützen kein `ssh -f` (Background Tunnels), was die Nutzung unnötig erschwert.
- **Stabilität:** Hintergrund-Tunnels brechen oft ab und erfordern manuellen Reconnect.
- **Robustheit:** Die direkte Exposition im LAN (Port 3000) ist die einfachste, robusteste Lösung für ein Ops-Dashboard im Heimnetz.
