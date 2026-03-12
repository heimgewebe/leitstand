# Leitstand Documentation Router

Leitstand is the visual control center of the Heimgewebe organism. It is organized into strict normative invariants (contracts) and operative runbooks. This router connects the "What is true?" (Contracts) with the "How does it stay true?" (Checks).

## Document Groups

- **Architecture:** Structure and decisions.
- **Runbooks:** Procedures for operations.
- **Reference:** Configuration, matrix.
- **Status:** State of the components.
- **Generated:** Automated maps and index.

## Canonical Documents

- `repo.meta.yaml` - Repository identity and structural truth.
- `AGENTS.md` - Agentic boundaries and safe read paths.
- `docs/index.md` - This documentation entry point.

## Read Order

1. [Runtime Contract](runtime.contract.md)
2. [Data Flow](data-flow.md)
3. [Access Matrix](access.matrix.md)

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

## 4. Generated Overviews

Generated overviews automatically describe this repository.

- [doc-index.md](_generated/doc-index.md) - List of all documents and rules
- [system-map.md](_generated/system-map.md) - Map of the system architecture

## 5. Decisions

- [WGX Leitstand Decision](decisions/wgx-leitstand.md)

## 6. Guides

- [Deploy Cloudflare](deploy-cloudflare.md)
- [Deployment](DEPLOYMENT.md)

## 7. Archive Logic

Deprecated features and code structure paths should be marked explicitly `deprecated` rather than removed directly. Archived documentation is moved to an `archive/` folder if created.

## 8. Repo Observatory

The Repo Observatory extends intelligent repositories with self-observation logic. Outputs are found in `_generated/`.

- `docs/_generated/architecture-drift.md`
- `docs/_generated/doc-coverage.md`
- `docs/_generated/knowledge-gaps.md`
- `docs/_generated/implicit-dependencies.md`
- `docs/_generated/change-resonance.md`
- `docs/_generated/staleness-report.md`
- `docs/_generated/agent-readiness.md`
