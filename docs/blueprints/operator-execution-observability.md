---
id: docs.blueprints.operator-execution-observability
title: "Blueprint: Operator Execution Observability"
doc_type: architecture
status: active
canonicality: supporting
owner: leitstand
summary: >
  Widen the read-only Leitstand observation surface to the execution axis
  (Bureau tasks, Grabowski checkouts) via producer-side snapshot bridges.
---

# Blueprint: Operator Execution Observability

## Motivation

Leitstand today visualises mostly the **knowledge axis** of the Heimgewebe
(Insights, Observatory, Reflexion) plus fleet health. The live operator
ecosystem — driven by **Grabowski** (local execution, leases, receipts, audit)
and **Bureau** (tasks, claims, dispatch) — emits far more observable operational
state than Leitstand renders. `repo.meta.yaml` even declares `bureau_state` as a
consumed input, yet no controller consumed it. This blueprint closes that gap
while preserving the read-only observer invariant.

## Gap at a glance

| Live operator state | Grabowski source | Before | After |
|---|---|---|---|
| Bureau tasks / claims / lifecycle | `bureau_state` export | ❌ declared, unimplemented | ✅ `/bureau` |
| Checkout / worktree inventory (sprawl) | `checkout_inventory` | ❌ | ✅ `/checkouts` |
| Deployment / contract drift (live) | `contract_drift`, `runtime_health` | ⚠️ static docs only | ▶ planned |
| Audit-chain health | `verify_audit` | ❌ | ▶ planned |
| Fleet hosts (heim-pc, heimserver, …) | `fleet_list` | ⚠️ repos only | ▶ planned |
| Friction / recovery gate | `friction_summary`, `recovery_status` | ❌ | ▶ planned |

## Architecture principle — the producer seam

The observer invariant means **Leitstand must not call Grabowski or Bureau at
request time**; doing so would couple the observer to execution. Instead every
operator surface follows the same seam that RepoBrief already demonstrates:

```
Grabowski / Bureau  →  [producer bridge]  →  contract-shaped JSON snapshot  →  Leitstand controller  →  view
   (execution truth)     scripts/export-        e.g. artifacts/bureau-tasks     read + validate +        read-only
                         operator-snapshots.mjs  .json                          freshness               render
```

The bridge (`scripts/export-operator-snapshots.mjs`) is producer-side: it reads
raw Grabowski/Bureau output and writes local snapshot artifacts. It performs no
external mutation. If Leitstand is down, execution truth continues unaffected
(`unavailable_effect: execution_truth_continues_without_leitstand`).

Every execution-axis view carries the same guarantees as the rest of Leitstand:
source kind, `generatedAt`, a freshness verdict, and an explicit
`doesNotEstablish` non-claims list so the UI never implies live control.

Default source paths are artifact paths:

- `artifacts/bureau-tasks.json`
- `artifacts/checkout-inventory.json`

Fixture data in `src/fixtures/` is demo/preview material only. Controllers may
use it only when `LEITSTAND_BUREAU_FIXTURE_FALLBACK=1`,
`LEITSTAND_CHECKOUT_FIXTURE_FALLBACK=1`, or explicit non-strict preview mode
(`LEITSTAND_STRICT=false|0`) is set. A fixture source is rendered as
`source_kind=fixture`; it is never labelled as an artifact or a green live
snapshot.

## Contracts

Two local view contracts (`schemaVersion: 1`), pinned by the bridge:

- **`leitstand_bureau_task_snapshot`** — `tasks[]` with normalised lifecycle
  states (`queued|claimed|running|blocked|done|failed|unknown`), claimant, repo,
  timestamps and optional receipt reference. Rendered as a lifecycle board.
- **`leitstand_checkout_inventory`** — `checkouts[]` with a retention verdict
  (`retained|archivable|orphan|unknown`), process/lease/runtime-match flags. Surfaces
  worktree **sprawl** (checkouts with no retention owner, process, or lease).

Both controllers degrade visibly on a missing/corrupt snapshot ("degraded
read-only state, not a green status") rather than hiding data loss. Preview
fixtures are also visibly marked as degraded/demo data and do not establish
execution truth. Demo fixtures must use synthetic example paths; internal source
artifact paths are rendered through a display label rather than exposed verbatim
in public/degraded notices.

## Implementation status (2026-07-07)

- [x] `src/controllers/bureau.ts` + `/bureau` view + tests.
- [x] `src/controllers/checkouts.ts` + `/checkouts` view + tests.
- [x] Producer bridge `scripts/export-operator-snapshots.mjs`.
- [x] Landing page + nav integration (execution-axis info card).
- [x] `repo.meta.yaml` / `.ai-context.yml` / [Data Flow](../data-flow.md) made honest.
- [ ] Live drift + audit-chain health tiles (`contract_drift`, `verify_audit`).
- [ ] Fleet-host layer in Anatomy (physical hosts as an axis).
- [ ] Friction / recovery-gate weak signals in the Reflexion layer.

## Invariants preserved

- No runtime calls from Leitstand to Grabowski/Bureau; snapshots only.
- Read-only: controllers only read and render; the observer-invariant guard
  (`scripts/ci/observer-invariant-guard.sh`) continues to pass.
- Missing/stale snapshots are shown, not concealed.

See also the [Leitstand Visualization Blueprint](leitstand_visualization.md) for
the phase model this extends.
