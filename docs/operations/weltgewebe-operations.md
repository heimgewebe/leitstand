---
id: docs.operations.weltgewebe-operations
title: Weltgewebe Operations Projection
doc_type: architecture
status: active
canonicality: canonical
summary: >
  Read-only Leitstand contract for provenance-bound Weltgewebe SLO, recovery, cell, federation and operator-reference evidence.
---

# Weltgewebe Operations Projection

## Purpose

`/weltgewebe` is a read-only operational projection for Weltgewebe. It makes a bounded set of already-observed source evidence visible in Leitstand without turning Leitstand into another control plane or source of truth.

The data flow is one-way:

```text
Weltgewebe / Flux / Bureau / Grabowski source observations
        ↓
producer-side normalization and provenance binding
        ↓
artifacts/weltgewebe-operations.json
        ↓
Leitstand /weltgewebe and /health
```

No arrow returns from Leitstand to Kubernetes, Flux, Weltgewebe, Bureau or Grabowski.

## Snapshot contract

The runtime artifact has:

- `schemaVersion: 1`;
- `kind: leitstand_weltgewebe_operations_snapshot`;
- one `generatedAt` timestamp;
- producer provenance;
- SLO evidence;
- recovery evidence;
- deployment evidence;
- bounded cell and neighborhood projections;
- federation-delivery evidence;
- bounded operator references;
- explicit `doesNotEstablish` non-claims.

The default runtime path is `artifacts/weltgewebe-operations.json`. `LEITSTAND_WELTGEWEBE_OPERATIONS_PATH` may bind a different exact artifact path. Fixture fallback is allowed only when explicitly enabled for preview/testing; fixture data is never current operational truth.

## Provenance

Every operational section and list item carries its own provenance object:

- `sourceSystem` — which source system supplied the observation;
- `sourceKind` — what kind of source evidence was observed;
- `sourceRef` — bounded source identifier;
- `observedAt` — when that source evidence was observed;
- `sourceCommit` — optional full Git commit when the source is revision-bound;
- `evidenceRefs` — one or more receipts or artifact references.

Leitstand computes freshness from `observedAt` but does not rewrite the source-provided state. A cell may therefore still say `healthy` while its provenance is displayed as `stale`. This is deliberate: freshness is Leitstand's observation about evidence age; `healthy` remains the source system's reported state.

## SLO and recovery

The projection can display:

- availability percentage;
- p95 latency;
- remaining error budget;
- measurement window;
- RTO;
- RPO;
- last restore timestamp and derived restore age;
- deployment environment, source state, Git commit and immutable image reference.

These values are not calculated from browser traffic. They must arrive as source-bound evidence through the producer artifact.

## Cells, neighborhoods and federation

Cells preserve their source-provided:

- ID;
- name;
- scope;
- state.

Neighborhood records preserve local cell ID, remote cell ID and source state. Federation evidence can show source state, delivery lag, pending count, quarantined count and latest delivery time.

Each record has independent provenance and freshness. Leitstand does not infer a global cell/federation state from these values.

## Operator references

Operator references may contain only context identifiers such as:

- `taskId`;
- `receiptRef`;
- title and source state;
- provenance.

They may not carry executable fields such as commands, argv arrays, HTTP methods, action URLs, mutation URLs or endpoints. The browser view links only to existing read-only Leitstand context such as `/bureau`.

If action is required, it must be performed through the authoritative source system and its existing approval/lease/receipt contract. Leitstand does not dispatch that action.

## Producer boundary

`scripts/export-operator-snapshots.mjs --weltgewebe-raw ...` is the producer-side normalization seam. It:

1. reads caller-supplied raw evidence outside the HTTP request path;
2. validates bounded known fields and provenance;
3. rejects executable operator fields;
4. preserves source state strings;
5. drops unknown fields instead of publishing them;
6. writes the complete snapshot atomically.

The exporter does not query Kubernetes, Flux, Bureau or Grabowski on behalf of an HTTP request. Source collection remains outside Leitstand.

## Freshness and failure semantics

The Weltgewebe operations snapshot uses the same fast operational freshness limit as Bureau/checkout/decision snapshots: 20 minutes.

- fresh valid snapshot → `/health` can remain `ok`;
- stale valid snapshot → `/health` becomes `warn`;
- missing, unreadable, invalid JSON or wrong contract → `/health` becomes `fail`;
- the `/weltgewebe` view shows missing/corrupt input as degraded and invents no replacement values.

## Non-claims

The projection does not establish:

- Weltgewebe source truth;
- Kubernetes or cluster control authority;
- federation control authority;
- Bureau task authority;
- Grabowski execution authority;
- deployment or rollback authority;
- external reachability or production correctness by itself.

Those claims require the authoritative source systems and their own revision-, receipt- and runtime-bound evidence.
