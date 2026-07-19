---
id: docs.architecture.feature-classification
title: Feature Classification
doc_type: architecture
status: active
canonicality: informational
summary: >
  Classifies the remaining Leitstand components by their read-only responsibility.
---

# Feature Classification

| Component | Responsibility | Explicit non-responsibility |
| --- | --- | --- |
| EJS views and browser shell | render bounded projections accessibly | no source decisions, no mutation |
| `server.ts` | route read-only views and health evidence | no ingestion, orchestration, authentication, or task dispatch |
| snapshot controllers | validate and normalize published local artifacts | no producer calls or repair actions |
| `runtimeHealth.ts` | report process, Git, artifact contract, and freshness evidence | no external reachability or authority claims |
| static builder | publish a bounded preview and route manifest | no runtime-artifact fetch or route parity claim |
| digest CLI | optional local report generation outside the web runtime | no HTTP route or operational authority |

Removed event, Ops, anatomy, physiology, phase, timeline, insights, observatory, intent, and reflexion views are not active feature classes.
