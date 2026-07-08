---
id: docs.runbooks.operator-snapshots
title: Leitstand Operator Snapshot Producer Runbook
status: active
doc_type: runbook
canonicality: canonical
summary: >
  Producer-side runbook for Bureau task snapshots and Grabowski checkout inventory consumed by Leitstand.
---

# Leitstand Operator Snapshot Producer Runbook

## Scope

This runbook defines how execution-axis state reaches Leitstand without giving Leitstand execution authority.

Leitstand consumes two local, contract-shaped artifacts:

| Snapshot | Contract kind | Leitstand path | View | Producer owner |
| --- | --- | --- | --- | --- |
| Bureau task lifecycle snapshot | `leitstand_bureau_task_snapshot` | `artifacts/bureau-tasks.json` | `/bureau` | Bureau-owned export, produced by an operator-side bridge |
| Grabowski checkout inventory | `leitstand_checkout_inventory` | `artifacts/checkout-inventory.json` | `/checkouts` | Grabowski-owned inventory export, produced by an operator-side bridge |

The bridge implementation in this repository is `scripts/export-operator-snapshots.mjs`. It is a format bridge only: it reads already-exported raw JSON and writes Leitstand-local artifacts. It does not claim tasks, dispatch agents, clean checkouts, push branches, merge pull requests, restart services, or mutate Bureau/Grabowski state.

## Producer ownership

Bureau remains the source of truth for:

- task identity;
- queue/lane state;
- claims and claimants;
- completion/receipt references;
- task lifecycle transitions.

Grabowski remains the source of truth for:

- linked checkout/worktree inventory;
- retention verdicts;
- process or lease signals;
- runtime-head matching;
- cleanup authority and cleanup receipts.

The raw producer exports may be stored anywhere outside Leitstand. Operators should use explicit file paths when invoking the bridge and should not treat files under `artifacts/` as upstream truth.

Recommended raw input names when exporting into a Leitstand checkout are:

```bash
mkdir -p artifacts/raw
# Bureau raw export, produced outside Leitstand.
artifacts/raw/bureau-tasks.raw.json
# Grabowski raw export, produced outside Leitstand.
artifacts/raw/checkout-inventory.raw.json
```

Recommended bridge invocation:

```bash
node scripts/export-operator-snapshots.mjs \
  --bureau-raw artifacts/raw/bureau-tasks.raw.json \
  --checkout-raw artifacts/raw/checkout-inventory.raw.json \
  --out-dir artifacts
```

Expected generated artifacts:

```text
artifacts/bureau-tasks.json
artifacts/checkout-inventory.json
```

## Refresh cadence and stale thresholds

Execution-axis data changes quickly enough that stale snapshots must be visible.

| Snapshot | Expected refresh cadence | Leitstand stale threshold | Rationale |
| --- | --- | --- | --- |
| Bureau task lifecycle snapshot | at least every 60 minutes during active operator work; after relevant Bureau task/claim merges when possible | 6 hours | task/claim state is operationally volatile |
| Grabowski checkout inventory | at least daily; after large worktree/branch cleanup or runtime-head changes when possible | 24 hours | checkout inventory changes slower but can drift materially |

The controller thresholds are encoded in:

- `src/controllers/bureau.ts` — 6 hour stale threshold.
- `src/controllers/checkouts.ts` — 24 hour stale threshold.

A stale snapshot remains renderable, but it is not a green status. Operators should refresh the raw producer export and rerun the bridge before treating the view as current.

## Failure semantics

Leitstand must show degraded states honestly.

| State | Meaning | Operational action | What Leitstand may do |
| --- | --- | --- | --- |
| `artifact` | Contract-shaped artifact loaded from `artifacts/` or explicit env path | Use as read-only view input; still respect freshness | render only |
| `stale` | Artifact exists but `generatedAt` is older than the controller threshold | Refresh producer export and rerun bridge outside Leitstand | show stale warning |
| `missing` | Artifact path is absent and fixture fallback is not enabled | Produce raw export and rerun bridge | render degraded empty state |
| `corrupt` | Artifact exists but is invalid JSON or violates contract shape | Regenerate artifact from source export; inspect bridge input | render degraded error state |
| `fixture` | Explicit preview fallback is active | Treat as demo/preview data only | render preview warning |

Fixture fallback is explicit only:

- `LEITSTAND_BUREAU_FIXTURE_FALLBACK=1` or `true`;
- `LEITSTAND_CHECKOUT_FIXTURE_FALLBACK=1` or `true`;
- or `LEITSTAND_STRICT=0|false` for preview/non-strict mode.

Fixture data must never be described as live, current, canonical, complete, or operationally green.

## Non-authority boundary

This runbook does not grant Leitstand authority to:

- claim, create, reorder, close, or verify Bureau tasks;
- dispatch Grabowski work;
- clean, delete, archive, or mutate checkouts;
- infer claim truth from rendered state;
- repair missing/corrupt artifacts automatically;
- establish runtime health or deployment readiness.

If snapshots are missing, stale, or corrupt, the repair action belongs to the producer side: Bureau/Grabowski export and operator bridge execution. Leitstand remains a read-only consumer.
