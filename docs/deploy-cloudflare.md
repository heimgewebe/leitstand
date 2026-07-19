---
id: docs.deploy-cloudflare
title: Deploying Leitstand to Cloudflare Pages
doc_type: guide
status: active
canonicality: canonical
summary: >
  Deployment of the bounded Leitstand static preview.
---

# Deploying Leitstand to Cloudflare Pages

Cloudflare Pages hosts an optional static preview, not the canonical runtime. The preview contains only `/`, browser assets, and `_static-boundary.json`.

## Build

Use `pnpm build:cf`. The command delegates to `pnpm build:static`; it does not fetch runtime artifacts because the preview does not render runtime-backed views.

The boundary manifest records:

- the supported static route;
- current runtime-only routes;
- removed routes;
- truths that the preview does not establish.

## Required configuration

No Leitstand runtime artifact or ingestion variables are required for the static preview. `SOURCE_DATE_EPOCH` may be supplied for a reproducible manifest timestamp.

## Verification

A successful preview build proves only that the static shell and boundary manifest were generated. It does not prove canonical runtime availability, source freshness, DNS, reverse-proxy behavior, or runtime route parity.

GitHub Pages remains manual-only and may be used as an additional static smoke surface. Main-branch health must not depend on a Pages environment being enabled.
