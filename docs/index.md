---
id: docs.index
title: Leitstand Documentation Router
doc_type: index
status: active
canonicality: canonical
summary: >
  Canonical entry point for all documentation.
---
# Leitstand Documentation Router

Leitstand is the visual control center of the Heimgewebe organism. It is organized into strict normative invariants (contracts) and operative runbooks. This router connects the "What is true?" (Contracts) with the "How does it stay true?" (Checks).

## Generated Overviews

- [Documentation Index](_generated/doc-index.md)
- [System Map](_generated/system-map.md)
- [Orphaned Documents](_generated/orphans.md)
- [Implementation Index](_generated/impl-index.md)
- [Backlinks Map](_generated/backlinks.md)
- [Supersession Map](_generated/supersession-map.md)
- [Agent Readiness](_generated/agent-readiness.md)

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
