# Deploying Leitstand to Cloudflare Pages

Leitstand relies on a deterministic build process where data artifacts are fetched *before* the static site generation.

## Required Environment Variables

Set these in your Cloudflare Pages project settings:

*   **`NODE_ENV`**: `production`
*   **`LEITSTAND_STRICT`**: `1` (Recommended to enforce artifact existence)
*   **`OBSERVATORY_URL`**: URL to the raw knowledge artifact (e.g., from semantAH release).
*   **`INSIGHTS_DAILY_URL`**: URL to the published insights artifact (e.g., from semantAH release).

## Build Command

The build command must explicitly fetch both artifacts before generating the static site:

```bash
pnpm build:cf
```

This command runs `fetch:observatory` and `fetch:insights` (populating the `artifacts/` directory) followed by `build:static`.

## Strict Mode Behavior

If `LEITSTAND_STRICT=1` (or `NODE_ENV=production`), the build will **fail** if:
1.  Artifacts cannot be fetched from the configured URLs.
2.  Fetched artifacts are invalid or empty.

This ensures that the deployed site never relies on fallback test fixtures in production.
