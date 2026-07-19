---
id: docs.runtime.contract
title: Runtime Contract
doc_type: reference
status: active
canonicality: canonical
summary: >
  Canonical network, route, release, and health contract for Leitstand.
---

# Runtime Contract

## Scope

This contract applies to the canonical internal runtime. The static preview has a separate, narrower boundary.

## Canonical endpoint

- FQDN: `leitstand.heimgewebe.home.arpa`
- transport: HTTPS through the internal reverse proxy
- application listener: explicit internal address, safe default `127.0.0.1:3000`
- release source: exact versioned Git head

Direct public exposure and unacknowledged wildcard binding are outside the contract.

## Route set

Current read-only runtime routes:

- `/`
- `/health`
- `/bureau`
- `/checkouts`
- `/storage-health`
- `/ecosystem-map`
- `/repoground`

`/repobriefs` is a permanent compatibility redirect to `/repoground`. No state-changing HTTP route is permitted. Removed legacy routes must return 404.

## Health contract

A healthy release requires:

- `/health` returns `kind=leitstand_runtime_health_receipt`;
- the reported Git head matches the intended release;
- required snapshot kinds validate;
- Bureau and checkout snapshots are no older than 20 minutes;
- storage health is no older than 90 minutes;
- the Systemkarte manifest is no older than 168 hours;
- the overall receipt status is `ok`.

A `warn` receipt is available but degraded. A `fail` receipt returns HTTP 503 and blocks rollout completion.

## Non-claims

The in-process receipt does not establish DNS correctness, TLS trust, reverse-proxy persistence, external reachability, source-system truth, task authority, cleanup authority, or successful deployment by itself. Those require separate infrastructure and source readbacks.

## Deployment completion

Deployment is complete only when release identity, listener ownership, HTTPS ingress, current route behavior, removed-route 404s, and `/health` evidence agree on the same release.
