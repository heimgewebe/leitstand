# Deployment

## Artifact Ingestion

The `leitstand` build process is designed to be resilient to missing upstream data.

### Observatory Data (`insights.daily.json`)

The Observatory view relies on `insights.daily.json`. In a production/CI environment (e.g., GitHub Pages build), this artifact is fetched from the `semantAH` repository (or a similar upstream source) and placed in `artifacts/insights.daily.json` before the build starts.

**Supply Chain:**
1.  `semantAH` (or producer) generates `insights.daily.json`.
2.  `leitstand` CI attempts to download this file to `artifacts/insights.daily.json`.
3.  `npm run build:static` (or `npm run start:server`) checks for this file.

**Fallback Mechanism:**
If `artifacts/insights.daily.json` is missing, empty, or invalid, the system automatically falls back to `src/fixtures/observatory.json`. This ensures that the dashboard is always buildable and viewable, even if the fresh data pipeline is temporarily broken.

**Verification:**
The UI explicitly indicates the source of the data:
- **"live artefakt"**: Data loaded successfully from `artifacts/insights.daily.json`.
- **"Fixture (Fallback)"**: Data loaded from `src/fixtures/observatory.json`.
