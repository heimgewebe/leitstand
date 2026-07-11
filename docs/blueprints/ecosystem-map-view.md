---
id: blueprint.ecosystem-map-view
title: Ecosystem Map View Blueprint
status: draft
doc_type: blueprint
canonicality: supporting
owner: leitstand
summary: >
  Read-only Leitstand viewer boundary for the Heimgewebe ecosystem map owned by the Systemkatalog.
---

# Ecosystem Map View Blueprint

## Purpose

Leitstand should provide a dashboard-friendly view of the Heimgewebe ecosystem map without becoming the owner of the map.

The canonical map semantics remain in the Systemkatalog. Leitstand may render or display system catalog map artifacts as an observer surface.

## Source Boundary

Canonical sources:

- Systemkatalog entry: `../systemkatalog/index.md` in local operator checkouts, or the GitHub `heimgewebe/systemkatalog` repository.
- Canonical generated map: `rendered/ecosystem-registry-map.mmd` in the Systemkatalog.
- Read-only artifact contract: `catalog/ecosystem-map-artifact-manifest.schema.v1.json` and the generated `rendered/ecosystem-map-artifact-manifest.json`.
- Map boundary and maintenance rules: `policy/ecosystem-map-view.v1.json` in the Systemkatalog.
- Registry inputs: `registry/ecosystem/nodes.json`, `registry/ecosystem/edges.json`, and `registry/ecosystem/claims.jsonl` in the Systemkatalog.

Leitstand must not maintain a competing graph, registry, or claim layer.

## View Contract

The first implementation should be read-only.

Allowed:

- fetch or vendor a pinned system catalog map artifact for display;
- render Mermaid into an HTML/SVG/dashboard component;
- show the system catalog commit, source path, and retrieval time;
- show a freshness or drift warning if the displayed map is not from the current Systemkatalog main;
- link back to the Systemkatalog as the canonical source.

Not allowed:

- editing system catalog map content from Leitstand;
- inferring claim truth from a Mermaid edge;
- treating Leitstand render success as system catalog map validity;
- dispatching tasks or changing other repos from the map view;
- silently replacing Systemkatalog as the source of map semantics.

## UI Placement

A future route can use a name such as `/ecosystem-map` or a card in the main dashboard.

The page should visibly state:

> View only. Canonical map semantics live in the Systemkatalog.

It should present at least:

1. readable overview map;
2. generated registry projection;
3. system catalog source links;
4. source commit or retrieval metadata;
5. boundary note explaining that the map is an orientation aid, not proof of runtime correctness or merge readiness.

## Implementation Phases

### Phase 0 — Documentation boundary

This blueprint defines the role split. No UI code is required in this phase.

### Phase 1 — Static local preview

Render the pinned canonical Systemkatalog `.mmd` artifact into a static view. The build must fail closed if the source path is missing or malformed.

### Phase 2 — Dashboard route

Expose a read-only route in Leitstand. It may display freshness metadata but must not write to the Systemkatalog or any other repo.

### Phase 3 — Freshness signal

Optionally compare the displayed artifact against a system catalog commit or manifest. A stale map should be flagged, not auto-repaired.

## Organs

- Systemkatalog: owns map semantics, registry, generated Mermaid projection, and validation.
- Leitstand: displays a read-only dashboard view and freshness signals.
- Schauwerk: may create presentation or publishing surfaces from approved sources.
- heim-pc: points local operators and agents toward the Systemkatalog.
- GitHub and CI: remain primary for repository state and check state.

## Non-goals

- no map editing in Leitstand;
- no system catalog registry duplication;
- no task dispatch from the map view;
- no runtime truth claims;
- no merge-readiness claims;
- no secret, local Home, or browser profile inspection.
