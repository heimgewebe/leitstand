---
id: docs.DEPLOYMENT
title: Deployment
doc_type: guide
status: active
canonicality: canonical
summary: >
  Deployment contract for the read-only Leitstand runtime and static preview.
---

# Deployment

## Canonical runtime

The canonical service is an internal, read-only Express runtime. It renders local exported artifacts and exposes `/health` as a bounded proof surface.

Required deployment properties:

- bind to the configured internal interface;
- run from a versioned release checkout;
- provide Bureau, Grabowski, storage-health, Systemkatalog, and RepoGround artifacts at their configured paths;
- publish no mutation, orchestration, event-ingestion, or task-dispatch endpoint;
- verify `/health`, the expected Git head, and source-specific artifact freshness after rollout.

The runtime intentionally returns 404 for `POST /events` because no such route is registered.

## Static preview

`pnpm build:static` creates a preview containing only `/` and `_static-boundary.json`. Runtime-backed views are not copied into the preview. The manifest records supported, runtime-only, and removed routes.

A successful static build does not establish canonical runtime availability, DNS correctness, reverse-proxy persistence, or source freshness.

## Verification

Run the repository quality gates and then verify the deployed release:

```text
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm build:static
```

Deployment-specific procedures live in the operator environment. Leitstand itself does not perform deployment actions.
