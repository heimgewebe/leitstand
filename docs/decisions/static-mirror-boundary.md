---
id: docs.decisions.static-mirror-boundary
title: Leitstand Static Mirror Boundary
status: active
doc_type: decision
canonicality: canonical
summary: >
  Defines the supported route set and GitHub Pages boundary for Leitstand Mode B static mirrors.
---

# Leitstand Static Mirror Boundary

## Decision

Leitstand Mode B is a **public static mirror / preview**, not the canonical runtime.

The current static build supports exactly these routes:

- `/`

`pnpm build:static` emits `dist/site/_static-boundary.json` with this supported route set and the explicitly dynamic-only routes.

## Dynamic-only routes

These routes are intentionally not part of the current static mirror:

- `/events` — runtime ingestion endpoint.
- `/bureau` — execution-axis snapshot view, runtime-rendered in Mode A until static artifact parity is implemented.
- `/checkouts` — checkout inventory view, runtime-rendered in Mode A until static artifact parity is implemented.
- `/ecosystem-map` — system catalog artifact projection, runtime-rendered until static artifact parity is implemented.
- `/repogrounds` — RepoGround bundle index view, runtime-rendered until static artifact parity is implemented.

## GitHub Pages boundary

GitHub Pages is **manual-only**. The workflow remains available for explicit Mode B smoke runs, but it is not triggered on every `main` push.

Cloudflare Pages remains the primary static preview surface. A missing or disabled GitHub Pages environment must not keep `main` red.

## Non-claims

This decision does not establish:

- canonical runtime availability;
- `/events` ingestion availability;
- Bureau task truth;
- Grabowski checkout truth;
- route parity between Mode A and Mode B.
