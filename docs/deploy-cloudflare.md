---
id: docs.deploy-cloudflare
title: Deploying Leitstand to Cloudflare Pages
doc_type: guide
status: active
canonicality: canonical
summary: >
  Deploying Leitstand to Cloudflare Pages
---

# Deploying Leitstand to Cloudflare Pages

> **Deployment Mode: B (Public Static Mirror)**
> This mode acts purely as a static read-only mirror. Dynamic endpoints (`/events`) are inactive. The supported static routes are `/`; `dist/site/_static-boundary.json` records the exact route boundary.

Leitstand relies on a deterministic build process where data artifacts are fetched *before* the static site generation.

## Required Environment Variables

Set these in your Cloudflare Pages project settings:

*   **`NODE_ENV`**: `production`
*   **`LEITSTAND_STRICT`**: `1` (Recommended to enforce artifact existence)

## Build Command

The build command must explicitly fetch both artifacts before generating the static site:

```bash
pnpm build:cf
```

This command runs `fetch:integrity` (populating the `artifacts/` directory) followed by `build:static`. The static build emits `dist/site/_static-boundary.json`; it is the machine-readable contract for the route set.

## Strict Mode Behavior

If `LEITSTAND_STRICT=1` (or `NODE_ENV=production`), the build will **fail** if:
1.  Artifacts cannot be fetched from the configured URLs.
2.  Fetched artifacts are invalid or empty.
3.  Artifact dependencies are fully resolvable. If one is missing, the build fails.

This ensures that the deployed site never relies on fallback test fixtures in production.

A `_meta.json` file is also generated in `artifacts/` to provide a forensic trail of what was fetched (size, timestamp, source). This is purely informational and not a source of truth for the build logic.

## Common Misconfigurations

1.  **Strict Mode without Fetch**: Setting `LEITSTAND_STRICT=1` but running only `pnpm build:static` (skipping fetch). This will cause the build to fail because artifacts are missing. **Always use `pnpm build:cf`**.
2.  **Missing Artifacts**: Make sure all expected artifacts are populated in `artifacts/` prior to the static build.

## GitHub Pages Boundary

GitHub Pages is intentionally manual-only in this repository. The workflow exists as an optional smoke for Mode B output, not as the primary public mirror and not as evidence of Mode A runtime health. Main pushes must not depend on a repository-level Pages environment being enabled.
