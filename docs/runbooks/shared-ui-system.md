---
id: runbook.shared-ui-system
title: Shared UI system
doc_type: runbook
status: active
canonicality: supporting
summary: >
  Versioned, read-only Leitstand UI foundations shared by the primary operational views.
---

# Shared UI system

## Purpose

LSV-V1-T008 centralizes the small set of presentation contracts that should not be redefined by every Leitstand view. The shared layer remains purely presentational: it does not create source truth, task authority, dispatch capability or write paths.

The versioned entry points are:

- `src/public/ui-system.css` for tokens, surfaces, spacing, status colors, tables, focus visibility, action sizing, responsive behavior, provenance disclosure and reduced motion;
- `src/views/_ui-head.ejs` for the ordered product stylesheet contract: shell first, shared UI second;
- view-local `<style>` blocks only for bounded view-specific structures such as the Bureau board, checkout flags, storage grids and the ecosystem map workspace.

## Migrated priority views

The dashboard, Bureau task board, RepoGround observability, ecosystem map, checkout health and storage health views all load the shared UI layer. The first four are the explicit T008 priority surfaces; checkout and storage views use the same foundations to avoid a parallel visual dialect.

Bureau, checkout and RepoGround views place their primary operational content before technical source metadata. Source and freshness details remain available in keyboard-accessible native `<details>` elements. The Bureau disclosure summary keeps source kind and freshness visible even while collapsed, because stale data changes how the board must be interpreted.

## Measured consolidation

The measurement compares the six primary EJS views before T008 with the first completed shared-layer migration:

| Measure | Before | After | Change |
| --- | ---: | ---: | ---: |
| Inline `<style>` blocks | 6 | 5 | RepoGround needs no view-local CSS |
| Inline style bytes | 22,671 | 13,362 | -9,309 bytes (-41.1%) |
| `style="…"` attributes | 3 | 0 | eliminated |
| View-local plain `body { … }` foundations | 6 | 0 | centralized |
| View-local plain `main { … }` foundations | 6 | 0 | centralized |
| Views using `_ui-head` | 0 | 6 | one stylesheet contract |

The remaining five inline style blocks are intentional, bounded exceptions for view-specific layout or interaction. Shared tokens include transitional aliases for existing dashboard-specific rules so the migration does not require a risky all-at-once rewrite.

## Regression contract

`tests/sharedUiSystem.test.ts` checks that all six primary views use the shared head partial, that shared foundations do not reappear in view-local CSS, that inline style attributes stay absent and that primary content precedes collapsible provenance on the migrated operational views.

The build-bound browser matrix additionally requires `/assets/ui-system.css` to be loaded on every real route/viewport pair. The existing 390×844 and 1440×900 regression checks continue to reject horizontal overflow, focus loss, broken mobile navigation, broken fullscreen focus containment, browser errors and active map transitions under reduced motion.

## Boundary

This layer establishes presentation consistency only. It does not establish:

- correctness or freshness of Bureau, RepoGround, checkout, storage or Systemkatalog data;
- permission to mutate any observed system;
- task claim, dispatch, merge or deployment authority;
- a second runtime state or truth model inside Leitstand.

Source adapters and controllers remain responsible for read-only projections; the UI renders their explicit source and degradation states.
