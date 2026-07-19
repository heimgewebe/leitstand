---
id: docs.runbooks.ops.runbook.leitstand-gateway.updates
title: Leitstand Gateway Updates
doc_type: runbook
status: active
canonicality: canonical
summary: >
  Safe update and rollback sequence for the read-only Leitstand runtime.
---

# Leitstand Gateway Updates

## Scope

This runbook covers only the Leitstand process, its release checkout, internal listener, and reverse-proxy path. Leitstand has no companion ACS service, mutation endpoint, or event-ingestion dependency.

## Preconditions

Before an update, record:

- current release commit and checkout path;
- service unit or container image identity;
- current `/health` receipt;
- listener address and owning process;
- rollback release identity;
- clean target checkout and available rollback path.

Do not update when the target checkout is dirty, the release identity is ambiguous, or port 3000 belongs to an unrelated process.

## Update

Deploy one exact, reviewed Leitstand release. Do not combine the rollout with unrelated repository pulls, gateway changes, cleanup, or dependency upgrades.

The safe default listener is `127.0.0.1`. A wildcard bind requires explicit `LEITSTAND_ALLOW_WIDE_BIND=true` and a separately verified host-level exposure boundary.

## Postflight

Verify all of the following on the deployed release:

1. service process is active and stable;
2. listener ownership and address match the intended network boundary;
3. `/health` reports the intended Git head;
4. required snapshots have the expected contract kinds and freshness limits;
5. `/`, `/bureau`, `/checkouts`, `/storage-health`, `/ecosystem-map`, and `/repoground` respond as intended;
6. `/repobriefs` redirects permanently to `/repoground`;
7. `POST /events` and all removed legacy routes return 404;
8. no unrelated process or checkout was changed.

## Rollback

If any postflight condition fails, restore only the previous verified Leitstand release and re-run the same checks. Do not prune, reset unrelated worktrees, delete data, or restart unrelated services.

If rollback verification also fails, stop further automatic attempts and preserve the release identities, health receipts, service logs, listener evidence, and configuration for diagnosis.

## Drift rule

Any change to the deployment mechanism, listener policy, release identity, health contract, or route set must update this runbook in the same pull request.
