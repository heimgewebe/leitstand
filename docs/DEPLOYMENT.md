# Deployment

## Artifact Ingestion

The `leitstand` build process is designed to be resilient to missing upstream data.

### Observatory Data (`knowledge.observatory.json`)

The Observatory view relies on `knowledge.observatory.json`. It supports both **Build-time Ingestion** and **Runtime Fetching** to ensure freshness.

**Runtime Supply Chain (Live Freshness):**
The browser fetches the artifact directly from the GitHub Release Asset (or configured `OBSERVATORY_URL`) when the page loads. This decouples data freshness from deployment frequency.
- **Source:** `https://github.com/heimgewebe/semantAH/releases/download/knowledge-observatory/knowledge.observatory.json` (Default)
- **Fallback:** If runtime fetch fails, the page displays the data baked in at build time (or fixture).

**Build Supply Chain (Initial State):**
In a production/CI environment (e.g., Cloudflare Pages build), this artifact is fetched from the same URL and placed in `artifacts/knowledge.observatory.json` before the build starts.

1.  `semantAH` (or producer) generates `knowledge.observatory.json` and publishes it as a Release Asset.
2.  `leitstand` CI attempts to download this file to `artifacts/knowledge.observatory.json` using `pnpm fetch:observatory`.
3.  `pnpm build:static` checks for this file and bakes it into the HTML (SSR).

**Environment Variables:**

| Variable | Description | Default / Required |
| :--- | :--- | :--- |
| `NODE_ENV` | Set to `production` in live environments to enforce fail-loud behavior. | `production` (in Prod) |
| `OBSERVATORY_URL` | URL to fetch the artifact from (Build & Runtime). | `https://github.com/...` (Release Asset) |
| `OBSERVATORY_ARTIFACT_PATH` | Local path to expect the artifact (Build time). | `artifacts/knowledge.observatory.json` |
| `OBSERVATORY_STRICT` | If `1`, enforces strict fetch validation (fail on 404/invalid). | `0` (Dev), `1` (Prod) |

**Fallback Mechanism:**
In **Production** environments (`NODE_ENV=production` or `OBSERVATORY_STRICT=1`), the build will **fail** if the artifact is missing, empty, or invalid. This ensures no stale or dummy data is deployed silently as the "Initial State".

In **Preview/Development** environments, if `artifacts/knowledge.observatory.json` is missing/invalid, the system automatically falls back to `src/fixtures/observatory.json`.

**Verification:**
The UI explicitly indicates the source of the data:
- **"Artefakt (knowledge.observatory.json)"**: Data loaded successfully from `artifacts/knowledge.observatory.json`.
- **"Fixture (Fallback)"**: Data loaded from `src/fixtures/observatory.json`.
