# Deployment

## Artifact Ingestion

The `leitstand` build process is designed to be resilient to missing upstream data.

### Observatory Data (`knowledge.observatory.json`)

The Observatory view relies on `knowledge.observatory.json`. In a production/CI environment (e.g., Cloudflare Pages build), this artifact is fetched from the `semantAH` repository (or a similar upstream source) and placed in `artifacts/knowledge.observatory.json` before the build starts.

**Supply Chain:**
1.  `semantAH` (or producer) generates `knowledge.observatory.json`.
2.  `leitstand` CI attempts to download this file to `artifacts/knowledge.observatory.json` using `pnpm fetch:observatory`.
3.  `pnpm build:static` checks for this file.

**Environment Variables:**

| Variable | Description | Default / Required |
| :--- | :--- | :--- |
| `NODE_ENV` | Set to `production` in live environments to enforce fail-loud behavior. | `production` (in Prod) |
| `OBSERVATORY_ARTIFACT_URL` | URL to fetch the artifact from. | `https://raw.githubusercontent.com/...` |
| `OBSERVATORY_ARTIFACT_PATH` | Local path to expect the artifact. | `artifacts/knowledge.observatory.json` |
| `OBSERVATORY_STRICT` | If `1`, enforces strict fetch validation (fail on 404/invalid). | `0` (Dev), `1` (Prod) |

**Fallback Mechanism:**
In **Production** environments (`NODE_ENV=production` or `OBSERVATORY_STRICT=1`), the build will **fail** if the artifact is missing, empty, or invalid. This ensures no stale or dummy data is deployed silently.

In **Preview/Development** environments, if `artifacts/knowledge.observatory.json` is missing/invalid, the system automatically falls back to `src/fixtures/observatory.json`.

**Verification:**
The UI explicitly indicates the source of the data:
- **"Artefakt (knowledge.observatory.json)"**: Data loaded successfully from `artifacts/knowledge.observatory.json`.
- **"Fixture (Fallback)"**: Data loaded from `src/fixtures/observatory.json`.
