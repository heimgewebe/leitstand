---
id: report.visualization-pilot-2026-07-05
title: Leitstand Visualization Pilot Evidence 2026-07-05
doc_type: report
status: active
canonicality: supporting
summary: >
  Internal pilot evidence for the Cabinet → Schauwerk → Leitstand visualization chain.
---

# Leitstand Visualization Pilot Evidence — 2026-07-05

## Purpose

This report records the first internal pilot of the ecosystem visualization chain after the Cabinet manifest, Leitstand source view, Schauwerk handoff, cross-view links, and RepoBrief observability slices were merged.

It is evidence of a read-only visualization chain. It is not evidence of runtime correctness, claim truth, merge readiness, review completeness, public export safety, or test sufficiency.

## Source commits

| Organ | Commit |
| --- | --- |
| Cabinet | `2ccd62b83a69ffc311efa8132741a83c1b994542` |
| Schauwerk | `b712c9f59f635df8fbceafd6511d435e0377094d` |
| Leitstand | `bc61b28c06fd02c9d2b97088bf80c1e8a4f45d40` |

## Pilot checks

| Check | Result |
| --- | --- |
| Cabinet ecosystem-map artifact manifest generated | pass |
| Cabinet manifest source commit | `2ccd62b83a69ffc311efa8132741a83c1b994542` |
| Schauwerk HTML handoff generated | pass |
| Schauwerk handoff kind | `schauwerk_ecosystem_map_html_handoff` |
| Schauwerk handoff mode | `source_html` |
| Schauwerk handoff SHA-256 | `355b43858d83ca82a7bb5866f31312066f3c6de562ada7c4b845fdef03bb9046` |
| Schauwerk handoff bytes | `8079` |
| Diagram rendered | `false` |
| Leitstand `/ecosystem-map` route present | pass |
| Leitstand `/repobriefs` route present | pass |
| Cross-view contract kind | `leitstand_ecosystem_map_cross_view_links` |
| Cross-view mapping count | `7` |
| RepoBrief index kind | `leitstand_repobrief_bundle_index` |
| RepoBrief bundle count | `1` |

## Degraded states observed

The pilot intentionally records degraded states instead of hiding them.

1. The RepoBrief bundle source commit is stale relative to current Leitstand main.
   - Bundle source: `0aeb59942d4b70d92129516139b4f46d3e07ec1d`
   - Current Leitstand: `bc61b28c06fd02c9d2b97088bf80c1e8a4f45d40`
2. RepoBrief export safety is not public-ready.
   - `exportSafety`: `fail`
   - `publicExportReady`: `false`
   - Warnings:
     - `claim-evidence sidecars skipped; no missing required artifacts`
     - `export gate missing or not pass; treat as internal analysis only`

## Organ boundaries confirmed

- Cabinet produced a source/provenance manifest for the ecosystem map.
- Schauwerk consumed the manifest and produced a bounded `source_html` handoff.
- Leitstand exposes read-only source, cross-link, and RepoBrief observability surfaces.
- Leitstand did not generate RepoBrief bundles, mutate Cabinet, fetch external data, dispatch tasks, or assert claim truth.

## Evidence file

Machine-readable evidence is recorded in:

```text
./visualization-pilot-2026-07-05.json
```

## Does not establish

This pilot does not establish:

- runtime correctness;
- claim truth;
- merge readiness;
- review completeness;
- public export safety;
- test sufficiency;
- that all relevant visualization sources are covered.

## Next action

Before treating the RepoBrief surface as current, generate or register a fresh Leitstand RepoBrief from current main and update the bundle index. That should remain a separate slice because it touches the RepoBrief production/registration path, not only the visualization surface.
