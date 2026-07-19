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

Production uses `scripts/leitstand-release.py` and the coupled versioned units `leitstand.service` plus `leitstand-storage-health.service`. Host-specific paths come from an exact JSON file based on `deploy/systemd/runtime-config.example.json`.

The deployment source must be an exact clean checkout whose `HEAD`, local required ref, local `origin/main` and live remote `main` all equal the reviewed merge commit. The adapter builds a sealed release, switches both units as one transaction, runs the storage producer and verifies local plus canonical HTTP behavior. A failed postflight restores both prior unit files and release selectors.

`./scripts/leitstand-up` remains an optional Docker/Compose development path. Its LAN mode requires `LEITSTAND_BIND_IP`; it is not the canonical production deployment.

See [Local Versioned Release Runtime](local-release-runtime.md) for commands, receipts, idempotency and rollback semantics.

## Freshness expectations

`/health` applies source-specific limits:

- Bureau: 20 minutes
- Checkouts: 20 minutes
- Storage health: 90 minutes
- Systemkarte: 168 hours

A stale snapshot is `warn`; a missing, unreadable, invalid, or contract-mismatched required snapshot is `fail`. The receipt reports its applied limit as `stale_after_seconds` for every source.

## Release verification

A release is acceptable only when:

1. vendored contracts, lint, typecheck, release-runtime tests, application tests, build, browser regression and repository guards pass on the exact release head;
2. the release manifest binds the intended commit, tree, origin-main ref and critical artifact hashes;
3. both user-systemd units bind the exact target release and expected FragmentPaths;
4. the storage producer finishes successfully from the target release;
5. local and canonical `/health` report the exact commit and all required snapshots as fresh;
6. active routes return 200, `/repobriefs` redirects structurally to `/repoground`, and removed routes plus `POST /events` return 404;
7. the web process remains stable and loopback-only on port 3000;
8. create-only deployment and completion receipts pass readback.

## Contract vendoring

`pnpm vendor:contracts` updates pinned contract copies. Vendored files and `_pin.json` must be reviewed and committed together. Runtime rendering must not fetch schemas dynamically.

## Failure handling

- **Build failure:** no unit, selector or running-service effect is permitted.
- **Unit or postflight failure:** both old unit files and release selectors must be restored, systemd reloaded, storage rerun and the old web service restarted.
- **Health `warn` or `fail`:** stop rollout; identify the exact stale, missing, invalid or mismatched source.
- **Git or tree mismatch:** fail closed. A healthy process running the wrong release is not successful.
- **Route regression:** fail closed when a removed mutation or legacy route becomes available again.
- **Incomplete restoration:** preserve receipts, unit backups and release directories; do not retry blindly.

The health receipt does not establish DNS, reverse-proxy persistence, external reachability, Bureau task truth, or cleanup authority.
