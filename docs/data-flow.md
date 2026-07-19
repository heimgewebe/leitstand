---
id: docs.data-flow
title: Leitstand – Data Flow & Required Inputs
doc_type: architecture
status: active
canonicality: canonical
summary: >
  Canonical read-only data flow and authority boundaries.
---

# Leitstand – Data Flow & Required Inputs

Leitstand is a terminal projection layer:

```text
source systems → bounded producer artifacts → Leitstand views
```

No arrow returns from Leitstand to a source system. Leitstand does not ingest events, dispatch tasks, trigger audits, alter repositories, or maintain independent operational truth.

## Inputs

| Contract kind | Default artifact | Runtime surface | Authority |
| --- | --- | --- | --- |
| `leitstand_bureau_task_snapshot` | `artifacts/bureau-tasks.json` | `/bureau`, `/health` | Bureau |
| `leitstand_checkout_inventory` | `artifacts/checkout-inventory.json` | `/checkouts`, `/health` | Grabowski |
| `leitstand_storage_health` | `artifacts/storage-health.json` | `/storage-health`, `/health` | storage-health producer |
| `system_catalog_map_artifact_manifest` | `artifacts/ecosystem-map-artifact-manifest.json` | `/ecosystem-map`, `/health` | Systemkatalog publication |
| RepoGround bundle index | configured RepoGround bundle path | `/repoground` | RepoGround publication |

The dashboard at `/` summarizes these projections. It does not combine them into a new source of truth.

## Producer boundary

Producers run outside the Leitstand request path. They write complete files atomically. Leitstand reads only the published file version and never calls Bureau, Grabowski, Systemkatalog, or RepoGround to repair missing evidence.

Development fixtures are allowed only as visibly marked non-operative examples. They must never be presented as current source truth.

## Freshness and failure semantics

| Source | Freshness limit | Stale | Missing, invalid, unreadable, wrong contract |
| --- | ---: | --- | --- |
| Bureau | 20 minutes | `warn` | `fail` |
| Checkouts | 20 minutes | `warn` | `fail` |
| Storage health | 90 minutes | `warn` | `fail` |
| Systemkarte | 168 hours | `warn` | `fail` |

Every snapshot entry in `/health` reports `age_seconds` and `stale_after_seconds`. RepoGround exposes its own source and freshness metadata in its view contract.

## Authority boundary

Leitstand may establish only what it directly observes from its process, Git checkout, and local files. It does not establish:

- external reachability, DNS, or reverse-proxy persistence;
- correctness of Bureau task decisions;
- cleanup or execution authority in Grabowski;
- correctness of Systemkatalog or RepoGround source claims;
- deployment success solely from a successful static preview.

This document supersedes older event-, insights-, anatomy-, physiology-, phase-, timeline-, reflexion-, and Ops-viewer flows. Historical reports and blueprints remain non-normative evidence only.
