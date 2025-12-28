# Deploying Leitstand to Cloudflare Pages

Leitstand relies on a deterministic build process where data artifacts are fetched *before* the static site generation.

## Required Environment Variables

Set these in your Cloudflare Pages project settings:

*   **`NODE_ENV`**: `production`
*   **`LEITSTAND_STRICT`**: `1` (Recommended to enforce artifact existence)
*   **`OBSERVATORY_URL`**: URL to the raw knowledge artifact (e.g., from semantAH release).
*   **`INSIGHTS_DAILY_URL`**: URL to the published insights artifact (e.g., from semantAH release).

> Note: `OBSERVATORY_STRICT` and `INSIGHTS_STRICT` are deprecated. Use `LEITSTAND_STRICT`.

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
3.  **Strict Symmetry Rule**: Both `knowledge.observatory.json` (Raw) and `insights.daily.json` (Published) MUST be present. If one is missing, the build fails.

This ensures that the deployed site never relies on fallback test fixtures in production.

A `_meta.json` file is also generated in `artifacts/` to provide a forensic trail of what was fetched (size, timestamp, source). This is purely informational and not a source of truth for the build logic.

## Common Misconfigurations

1.  **Strict Mode without Fetch**: Setting `LEITSTAND_STRICT=1` but running only `pnpm build:static` (skipping fetch). This will cause the build to fail because artifacts are missing. **Always use `pnpm build:cf`**.
2.  **Missing URLs**: If `OBSERVATORY_URL` or `INSIGHTS_DAILY_URL` are not set, the fetch step will fallback to defaults (GitHub Releases), which might not be desired for private setups.
