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

Leitstand is the visual control center of the Heimgewebe organism. It is organized into strict normative invariants (contracts) and operative runbooks. This router connects the "What is true?" (Contracts) with the "How does it stay true?" (Checks).

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

## 5. Deployment Modes

Leitstand operates in exactly one of two explicit modes:

**Mode A — Canonical Runtime (Internal Gateway)**
- Scope: canonical operative environment.
- Topology: internal-only, Reverse Proxy required, FQDN `leitstand.heimgewebe.home.arpa`.
- Features: fully dynamic, `/events` ingestion active, `/ops` viewer configurable.
- Documentation: [Runtime Contract](runtime.contract.md), [Deployment Overview](DEPLOYMENT.md)

**Mode B — Public Static Mirror / Preview**
- Scope: optional, read-only public mirror or PR preview.
- Topology: static host (Cloudflare Pages, GitHub Pages).
- Features: static build only. No active runtime, no `/events` ingestion, no `/ops` dynamic fallbacks.
- Documentation: [Cloudflare Deployment](deploy-cloudflare.md), `.github/workflows/pages.yml`
