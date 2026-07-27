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
| `leitstand_operator_decision_axis_snapshot` | `artifacts/operator-decision-axis.json` | `/`, `/health` | Bureau and Grabowski producer evidence |
| `leitstand_repobrief_bundle_index` | `artifacts/repoground-bundles.json` | `/repoground`, `/health` | canonical RepoGround publications |
| `leitstand_source_head_snapshot` | `artifacts/ecosystem-map-current-head.json` | `/ecosystem-map`, `/health` | Systemkatalog remote `main` observation |
| `leitstand_storage_health` | `artifacts/storage-health.json` | `/storage-health`, `/health` | storage-health producer |
| `system_catalog_map_artifact_manifest` | configured immutable Systemkatalog release | `/ecosystem-map`, `/health` | Systemkatalog publication |

The dashboard at `/` summarizes these projections. Every general panel must name its primary source, expose freshness, and state that the display is a non-authoritative projection. It does not combine the inputs into a new source of truth.

## Producer boundary

Producers run outside the Leitstand request path. They write complete files atomically. Leitstand reads only the published file version and never calls Bureau, Grabowski, Systemkatalog, or RepoGround to repair missing evidence.

Development fixtures are allowed only as visibly marked non-operative examples. They must never be presented as current source truth.

## Freshness and failure semantics

| Source | Freshness limit | Stale | Missing, invalid, unreadable, wrong contract |
| --- | ---: | --- | --- |
| Bureau | 20 minutes | `warn` | `fail` |
| Checkouts | 20 minutes | `warn` | `fail` |
| Decision axis | 20 minutes | no priority items rendered | `fail` |
| RepoGround publication index | 20 minutes | no bundles rendered | `fail` |
| Systemkatalog canonical head | 20 minutes | `warn` | `fail` |
| Storage health | 90 minutes | `warn` | `fail` |
| Systemkarte manifest | 168 hours | `warn` | `fail` |

Every snapshot entry in `/health` reports `age_seconds` and `stale_after_seconds`. The selected Systemkatalog release must equal the fresh canonical-head snapshot. RepoGround exposes bundles only when the canonical publication catalog is explicitly available and fresh.

## Authority boundary

Leitstand may establish only what it directly observes from its process, Git checkout, and local files. It does not establish:

- external reachability, DNS, or reverse-proxy persistence;
- correctness of Bureau task decisions;
- cleanup or execution authority in Grabowski;
- correctness of Systemkatalog or RepoGround source claims;
- deployment success solely from a successful static preview.

This document supersedes older event-, insights-, anatomy-, physiology-, phase-, timeline-, reflexion-, and Ops-viewer flows. Historical reports and blueprints remain non-normative evidence only.
