---
id: docs.decisions.static-mirror-boundary
title: Leitstand Static Mirror Boundary
status: active
doc_type: decision
canonicality: canonical
summary: >
  Defines the supported, runtime-only, and removed route sets for static previews.
---

# Leitstand Static Mirror Boundary

## Decision

The static preview is not the canonical runtime. It supports exactly `/` and publishes `dist/site/_static-boundary.json` as its machine-readable boundary.

## Runtime-only routes

These current routes require local runtime artifacts and are not part of the preview:

- `/bureau`
- `/checkouts`
- `/storage-health`
- `/ecosystem-map`
- `/repoground`

## Removed routes

The following paths are neither static nor runtime contracts:

- `/events`
- `/ops`
- `/observatory`
- `/intent`
- `/anatomy`
- `/timeline`
- `/insights`
- `/reflexion`

`/repobriefs` exists only as a runtime compatibility redirect to `/repoground`.

## Non-claims

A successful static build does not establish canonical runtime availability, DNS or reverse-proxy correctness, source freshness, Bureau task truth, Grabowski checkout truth, Systemkatalog truth, or route parity with the runtime.
