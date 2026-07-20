---
id: report.visualization-pilot-2026-07-20
title: Leitstand Visualization Pilot Evidence 2026-07-20
doc_type: report
status: active
canonicality: supporting
summary: >
  Commit-bound pilot evidence for LSV-V1-T007 covering real source identities,
  explicit degraded states and the view-only Leitstand boundary.
---

# Leitstand Visualization Pilot Evidence — 2026-07-20

## Result

`LSV-V1-T007` is exercised against Leitstand commit
`4218e10ab4ea9dc029c98009f4f142c7bbcc81eb`.

The machine-readable evidence is
[`visualization-pilot-2026-07-20.json`](./visualization-pilot-2026-07-20.json).
It is the normative pilot record for the exact source identities and scenario
classification below.

## Evidence model

The pilot separates two kinds of evidence:

1. **Live artifacts** record files that existed and were read on the operator
   host. Only identity, digest, timestamp and bounded status fields are copied.
2. **Synthetic fault injection** exercises missing, corrupt and stale inputs in
   isolated tests. These scenarios prove degraded-state behavior; they are not
   reported as live incidents.

This distinction prevents a test fixture from being mistaken for operational
history.

## Real source identities

| Source | Artifact | Source commit | Observed state |
| --- | --- | --- | --- |
| Systemkatalog | production-bound ecosystem-map manifest | `a765da7e1222b435c35b4797adb01dfba5a8b1b8` | valid |
| RepoGround | canonical RepoGround bundle publication | `9b4b643c448e018049d03ab1ec945af99018e2b1` | valid |
| Chronik | canonical RepoGround publication for Chronik | `63154c36fcd806bd2ac140f1ef287ea0c5fc914e` | valid identity only |
| WGX | canonical RepoGround publication for WGX | `01efb27f424466c951a196f095c549d1afdd10da` | valid identity only |
| semantAH | canonical RepoGround publication for semantAH | `d53000a909946a0381a8b365c4af7abd2456e8f6` | valid identity only |

The Chronik, WGX and semantAH rows prove the existence and provenance of their
repository publications. They do not prove ledger integrity, runtime health,
metric truth, semantic quality or deployment correctness.

## Explicit degraded states

| State | Evidence | Live incident? | Expected Leitstand behavior |
| --- | --- | --- | --- |
| `missing` | isolated controller fault injection | no | empty/degraded state, never green |
| `corrupt` | malformed JSON and digest mismatch tests | no | reject trusted rendering input |
| `stale` | freshness-window test plus an older real Leitstand RepoGround publication | mixed | readable but visibly non-current or unknown |
| `export-safety-fail` | real export-safety report with status `fail` | yes | failure stays visible and blocks public-ready framing |

The real export-safety failure is digest-bound to
`b0cf4ffb2ee6bbbb7277cb5fe70dd48080d212a033d5c156a42dc1e03290af39`.
Its recorded reason is
`agent_export_gate_required_but_missing_or_not_pass`.

## Validation

- Focused Vitest set: **37/37 passed** across ecosystem-map, navigation and
  RepoGround controller/view tests.
- Browser shell regression against the sealed production release:
  **mobile 21/21**, **desktop 13/13**.
- Production service: active/running with zero recorded restarts and exact
  release commit `4218e10ab4ea9dc029c98009f4f142c7bbcc81eb`.

## View-only boundary

The pilot and the represented Leitstand views are **view-only**. They contain no
capability for task dispatch, source repair, repository mutation, merge,
deployment or external refresh. Local paths are evidence pointers, not public
links and not permission grants.

## Does not establish

This pilot does not establish:

- source truth;
- runtime correctness;
- comprehensive source coverage;
- public export safety;
- visual perfection;
- future freshness;
- task readiness.
