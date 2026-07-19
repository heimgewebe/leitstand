---
id: docs.runbooks.leitstand
title: Leitstand Runbook
doc_type: runbook
status: active
canonicality: canonical
summary: >
  Operative checks for the read-only Leitstand runtime.
---

# Leitstand Runbook

## Runtime contract

Leitstand reads exported evidence and renders it. It does not ingest events, dispatch tasks, trigger audits, alter source systems, or maintain a second truth model.

Current inputs:

| Surface | Input |
| --- | --- |
| Bureau | `bureau-tasks.json` |
| Checkouts | `checkout-inventory.json` |
| Storage | `storage-health.json` |
| Systemkarte | `ecosystem-map-artifact-manifest.json` and verified map artifacts |
| RepoGround | RepoGround bundle index |

## Canonical deployment

Use `./scripts/leitstand-up` from a clean, versioned checkout. The default mode binds to loopback. Proxy mode uses `./scripts/leitstand-up --proxy`. LAN mode uses `./scripts/leitstand-up --lan` and requires an explicit `LEITSTAND_BIND_IP`; an unacknowledged wildcard bind is not an acceptable release state.

The script is the canonical Compose entry point, but its successful exit does not replace Git-head, route, health, listener, DNS, TLS, or proxy readbacks.

## Freshness expectations

`/health` applies source-specific limits:

- Bureau: 20 minutes
- Checkouts: 20 minutes
- Storage health: 90 minutes
- Systemkarte: 168 hours

A stale snapshot is `warn`; a missing, unreadable, invalid, or contract-mismatched required snapshot is `fail`. The receipt reports its applied limit as `stale_after_seconds` for every source.

## Release verification

A release is acceptable only when:

1. lint, typecheck, build, tests, and static build pass on the exact release head;
2. the deployed Git head matches the intended release;
3. `/health` returns the expected process, Git, snapshot, and freshness evidence;
4. `/events`, `/ops`, and the removed legacy views are unavailable;
5. `/repoground` renders and `/repobriefs` redirects permanently to it;
6. the runtime remains internally bound according to the deployment configuration.

## Contract vendoring

`pnpm vendor:contracts` updates pinned contract copies. Vendored files and `_pin.json` must be reviewed and committed together. Runtime rendering must not fetch schemas dynamically.

## Failure handling

- **Health `warn`:** inspect the named stale or timestamp-degraded producer; do not treat the warning as source failure without producer evidence.
- **Health `fail`:** stop rollout or roll back to the last verified release; identify whether the file is missing, invalid, unreadable, or contract-mismatched.
- **Git mismatch:** fail closed. A healthy process running the wrong head is not a successful deployment.
- **Route regression:** fail closed when a removed mutation or legacy route becomes available again.

The health receipt does not establish DNS, reverse-proxy persistence, external reachability, Bureau task truth, or cleanup authority.
