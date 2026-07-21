---
id: docs.operator-ecosystem-alignment
title: Operator Ecosystem Alignment
status: active
doc_type: guide
canonicality: supporting
owner: leitstand
summary: >
  Read-only Leitstand boundary in the Heimgewebe role map.
---

# Operator ecosystem alignment

Leitstand is a read-only observer surface in the Heimgewebe operator ecosystem.

- Chronik owns append-only event history.
- Plexer transports bounded operational events and delivery status.
- Bureau owns tasks, claims, dispatch and completion records.
- Grabowski owns local execution, leases, receipts and audit.
- Heimlern produces retrospective learning and policy-adaptation proposals.
- Leitstand renders views and digests; it does not execute or orchestrate.

Plexer is not the only communication path. Contracts, GitHub/CI, direct artifact reads, Chronik queries and Plexer events are parallel channels. Use the path that preserves evidence and avoids hidden coupling.


## Single general operator entry

The canonical general live-status entry is the Leitstand dashboard at `/`. It is a read-only projection that aggregates attention and freshness signals but never becomes authoritative for the underlying facts. Direct specialist surfaces remain available for diagnosis and source-level verification.

## Duplicate-panel map

| Surface | Classification | Primary source / role | General-status rule |
| --- | --- | --- | --- |
| Leitstand `/` | general operator display | derived from all listed source artifacts | the only documented general status entry |
| Leitstand `/bureau` | specialist projection | Bureau | task/claim detail only; source-linked and non-authoritative |
| Leitstand `/checkouts` | specialist projection | Grabowski | checkout/worktree detail only; source-linked and non-authoritative |
| Leitstand `/storage-health` | specialist projection | storage-health producer | storage detail only; source-linked and non-authoritative |
| Leitstand `/ecosystem-map` | specialist projection | Systemkatalog publication | stable relationships only; not live operational truth |
| Leitstand `/repoground` | specialist projection | RepoGround publication | repository-grounding detail only |
| Systemkatalog direct views | stable catalog | Systemkatalog | status-free by contract; no competing general dashboard |
| Schauwerk live images / operator views | specialist renderer | declared source packages and provider readbacks | visual specialization only; not the general operator entry or source truth |

Remote role evidence was rechecked on 2026-07-21 against Systemkatalog `4d8549965240f50b784e27960d942dc6389f16b3`, whose README states that it is not a control or status system and names Leitstand as the general live display, and Schauwerk `013d6d2c28e6e7eb7109d660e7a133563992c405`, whose README states that source systems remain authoritative and describes its operator/live surfaces as projections and renderers. These observations are evidence for the boundary, not authority over those repositories.

## Failure mode and fallback

Leitstand is not on the execution path. If the web runtime is unavailable, operation continues through the source systems: Bureau for task and claim truth, Grabowski for execution/worktrees/leases/receipts, runtime healthchecks and logs for services, Systemkatalog's static read-only catalog and query surface for stable roles, RepoGround for repository context, and Schauwerk for specialized visual views. A Leitstand outage therefore removes the general convenience display, not the underlying source CLIs, artifacts, or direct specialist views.

No fallback is allowed to silently promote a specialist projection into a new general source of truth.
