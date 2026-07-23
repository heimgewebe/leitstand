---
id: docs.index
title: Leitstand Documentation Router
doc_type: reference
status: active
canonicality: canonical
summary: >
  Current documentation routes and runtime boundaries for Leitstand.
---

# Leitstand Documentation Router

Leitstand is the read-only observation surface for the Heimgewebe operator ecosystem. The dashboard at `/` is the single documented general operator status entry. It renders exported evidence and does not orchestrate, mutate, dispatch tasks, ingest events, or establish source truth. Direct source CLIs and specialist Systemkatalog, RepoGround and Schauwerk views remain valid fallbacks when Leitstand is unavailable.

## Normative boundaries

- [Runtime Contract](runtime.contract.md)
- [Drift Signals](drift.signals.md)
- [Access Matrix](access.matrix.md)
- [Data Flow](data-flow.md)
- [Security Policy](../SECURITY.md)
- [Tracked WGX Profile Decision](decisions/wgx-leitstand.md)
- [Operator Decision Axis Blueprint](blueprints/operator-decision-axis.md)

## Operative runbooks

- [Leitstand Main Runbook](runbooks/leitstand.md)
- [Local Versioned Release Runtime](runbooks/local-release-runtime.md)
- [Leitstand Gateway](runbooks/ops.runbook.leitstand-gateway.md)
- [Leitstand Gateway Updates](runbooks/ops.runbook.leitstand-gateway.updates.md)
- [Operator Snapshot Producer Runbook](runbooks/operator-snapshots.md)
- [Bounded Storage Health Projection](operations/storage-health.md)
- [Local Test Runner Compatibility](runbooks/local-test-runner.md)

## Current runtime surfaces

| Route | Purpose | Source truth |
| --- | --- | --- |
| `/` | compact source, attention and read-only decision-axis overview | derived local snapshot artifacts only |
| `/health` | in-process runtime and artifact-freshness receipt | current process and local files |
| `/bureau` | Bureau task and claim projection | Bureau snapshot |
| `/checkouts` | checkout and worktree projection | Grabowski snapshot |
| `/storage-health` | bounded storage-health projection | storage-health artifact |
| `/ecosystem-map` | system relationships | Systemkatalog artifact manifest |
| `/repoground` | repository-grounding bundles | RepoGround bundle index |

`/repobriefs` is a compatibility redirect to `/repoground`. Removed routes such as `/events`, `/ops`, `/observatory`, `/intent`, `/anatomy`, `/timeline`, `/insights`, and `/reflexion` are not active contracts.

## Deployment modes

**Canonical runtime:** Internal read-only service deployed as an immutable, exact-commit user-systemd release. The web and storage-health units are switched and rolled back as one receipt-bound transaction.

**Static mirror:** Optional preview containing only `/`. Its `_static-boundary.json` records supported, runtime-only, and removed routes. It does not prove runtime availability or source freshness.

See [Deployment](DEPLOYMENT.md), [Local Versioned Release Runtime](runbooks/local-release-runtime.md), [Static Mirror Boundary](decisions/static-mirror-boundary.md), and [Cloudflare Deployment](deploy-cloudflare.md).

## Historical material

Files under `docs/reports/` and explicitly informational blueprints preserve historical evidence. They do not override the current route and authority boundaries above.
