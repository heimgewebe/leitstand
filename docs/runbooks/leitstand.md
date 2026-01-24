# Leitstand Runbook

## Inputs and Data Flow

Leitstand aggregates data from multiple sources to provide a unified dashboard.

### 1. Knowledge Observatory
- **Source:** SemantAH (`knowledge.observatory.json`)
- **Ingest:** Via Plexer Event (`knowledge.observatory.published.v1`) -> `scripts/fetch-observatory.mjs`
- **Validation:** Strict AJV against `vendor/contracts/knowledge/observatory.schema.json` (Vendored snapshot from metarepo SSOT)

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
