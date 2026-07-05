---
id: blueprint.ecosystem-map-view
status: draft
doc_type: blueprint
canonicality: supporting
owner: leitstand
summary: >
  Read-only Leitstand viewer boundary for the Cabinet-owned Heimgewebe ecosystem map.
---

# Ecosystem Map View Blueprint

## Purpose

Leitstand should provide a dashboard-friendly view of the Heimgewebe ecosystem map without becoming the owner of the map.

The canonical map semantics remain in Cabinet. Leitstand may render or display Cabinet map artifacts as an observer surface.

## Source Boundary

Canonical sources:

- Cabinet entry: `../cabinet/index.md` in local operator checkouts, or the GitHub `heimgewebe/cabinet` repository.
- Readable overview: `rendered/ecosystem-map.mmd` in Cabinet.
- Generated registry projection: `rendered/ecosystem-registry-map.mmd` in Cabinet.
- Map boundary and maintenance rules: `docs/blueprints/ecosystem-map-v0.md` in Cabinet.
- Registry inputs: `registry/ecosystem/nodes.json`, `registry/ecosystem/edges.json`, and `registry/ecosystem/claims.jsonl` in Cabinet.

Leitstand must not maintain a competing graph, registry, or claim layer.

## View Contract

The first implementation should be read-only.

Allowed:

- fetch or vendor a pinned Cabinet map artifact for display;
- render Mermaid into an HTML/SVG/dashboard component;
- show the Cabinet commit, source path, and retrieval time;
- show a freshness or drift warning if the displayed map is not from the current Cabinet main;
- link back to Cabinet as the canonical source.

Not allowed:

- editing Cabinet map content from Leitstand;
- inferring claim truth from a Mermaid edge;
- treating Leitstand render success as Cabinet map validity;
- dispatching tasks or changing other repos from the map view;
- silently replacing Cabinet as the source of map semantics.

## UI Placement

A future route can use a name such as `/ecosystem-map` or a card in the main dashboard.

The page should visibly state:

> View only. Canonical map semantics live in Cabinet.

It should present at least:

1. readable overview map;
2. generated registry projection;
3. Cabinet source links;
4. source commit or retrieval metadata;
5. boundary note explaining that the map is an orientation aid, not proof of runtime correctness or merge readiness.

## Implementation Phases

### Phase 0 — Documentation boundary

This blueprint defines the role split. No UI code is required in this phase.

### Phase 1 — Static local preview

Render a pinned Cabinet `.mmd` artifact into a static view. The build must fail closed if the source path is missing or malformed.

### Phase 2 — Dashboard route

Expose a read-only route in Leitstand. It may display freshness metadata but must not write to Cabinet or any other repo.

### Phase 3 — Freshness signal

Optionally compare the displayed artifact against a Cabinet commit or manifest. A stale map should be flagged, not auto-repaired.

## Organs

- Cabinet: owns map semantics, registry, generated Mermaid projection, and validation.
- Leitstand: displays a read-only dashboard view and freshness signals.
- Schauwerk: may create presentation or publishing surfaces from approved sources.
- heim-pc: points local operators and agents toward Cabinet.
- GitHub and CI: remain primary for repository state and check state.

## Non-goals

- no map editing in Leitstand;
- no Cabinet registry duplication;
- no task dispatch from the map view;
- no runtime truth claims;
- no merge-readiness claims;
- no secret, local Home, or browser profile inspection.
