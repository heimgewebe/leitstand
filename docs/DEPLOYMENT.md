# Deployment

## Artifact Ingestion

The `leitstand` build process is designed to be resilient to missing upstream data.

### Observatory Data (`knowledge.observatory.json`)

The Observatory view relies on `knowledge.observatory.json`. In a production/CI environment (e.g., Cloudflare Pages build), this artifact is fetched from the `semantAH` repository (or a similar upstream source) and placed in `artifacts/knowledge.observatory.json` before the build starts.

**Supply Chain:**
1.  `semantAH` (or producer) generates `knowledge.observatory.json`.
2.  `leitstand` CI attempts to download this file to `artifacts/knowledge.observatory.json` using `npm run fetch:observatory`.
3.  `npm run build:static` (or `npm run start:server`) checks for this file.

**Fallback Mechanism:**
In **Production** environments (`NODE_ENV=production`), the build will **fail** if the artifact is missing. This ensures no stale or dummy data is deployed silently.

In **Preview/Development** environments, if `artifacts/knowledge.observatory.json` is missing, empty, or invalid, the system automatically falls back to `src/fixtures/observatory.json`.

**Verification:**
The UI explicitly indicates the source of the data:
- **"Artefakt (knowledge.observatory.json)"**: Data loaded successfully from `artifacts/knowledge.observatory.json`.
- **"Fixture (Fallback)"**: Data loaded from `src/fixtures/observatory.json`.
