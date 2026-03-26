---
id: docs.index
title: Leitstand Documentation Router
doc_type: reference
status: active
canonicality: canonical
summary: >
  Leitstand Documentation Router
---

# Leitstand Documentation Router

Leitstand is the visual monitoring center of the Heimgewebe organism. In its default, strict viewer-only mode it adheres to the Observer Invariant: it does not orchestrate or mutate external systems (see [Non-Goals](architecture/non-goals.md) and [Feature Classification](architecture/feature-classification.md)). Some deployments may optionally enable an Ops Viewer fallback that can POST to `agent-control-surface` (acs) to trigger audit jobs; this is a controlled, opt-in exception explicitly classified outside the core Observer Invariant. Leitstand is organized into strict normative invariants (contracts) and operative runbooks. This router connects the "What is true?" (Contracts) with the "How does it stay true?" (Checks).

## Canonicality & Discovery
* *Note: Generated files are currently structural placeholders. A full semantic graph generator is not yet active.*
* Generated Overviews: [doc-index.md](_generated/doc-index.md), [system-map.md](_generated/system-map.md), [orphans.md](_generated/orphans.md)
* Agent readiness & supersession: [agent-readiness.md](_generated/agent-readiness.md), [supersession-map.md](_generated/supersession-map.md)

## 1. Normative Invariants

Small, stable, hard rules and diagnostic signals.

- [Runtime Contract](runtime.contract.md)
- [Drift Signals](drift.signals.md)
- [Access Matrix](access.matrix.md)
- [Data Flow](data-flow.md)

## 2. Operative Runbooks

Detailed procedures, explicitly separated from the normative core to preserve the UI/Observer boundary.

- [Leitstand Gateway Runbook](runbooks/ops.runbook.leitstand-gateway.md)
- [Leitstand Gateway Updates](runbooks/ops.runbook.leitstand-gateway.updates.md)
- [Leitstand Main Runbook](runbooks/leitstand.md)

## 3. Tooling & Checks

Tools that enforce the rules automatically.

- [Vendor Contracts Script](../scripts/vendor-contracts.mjs) (Vendors schemas offline)
- [Check Artifacts Script](../scripts/check-artifacts.mjs) (Strict-Mode Gate)

## 4. Architecture Decisions & Blueprints

- [WGX Leitstand Decision](decisions/wgx-leitstand.md)
- [Leitstand Manifest Blueprint](blueprints/leitstand_manifest.md)
- [Leitstand Visualization Blueprint](blueprints/leitstand_visualization.md)

## 5. Deployment

- [Deployment Overview](DEPLOYMENT.md)
- [Cloudflare Deployment](deploy-cloudflare.md)
