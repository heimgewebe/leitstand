---
id: docs.runbooks.ops.runbook.leitstand-gateway
title: Leitstand Gateway
doc_type: runbook
status: active
canonicality: canonical
summary: >
  Canonical internal ingress boundary for the read-only Leitstand runtime.
---

# Leitstand Gateway

## Purpose

The gateway exposes one internal, read-only Leitstand service. It does not expose a companion API, ACS actor, event-ingestion endpoint, or public control surface.

## Invariants

- canonical FQDN: `leitstand.heimgewebe.home.arpa`;
- HTTPS through the internal reverse proxy;
- no WAN publication;
- the application listener is internal and explicitly owned;
- direct Node/systemd operation defaults to `127.0.0.1:3000`;
- wildcard binding requires explicit acknowledgement and a separately verified host exposure boundary;
- Leitstand routes remain read-only;
- source artifacts remain authoritative outside Leitstand.

## Routing

The proxy forwards the canonical host to the single Leitstand upstream. It must not publish removed legacy paths through another backend or rewrite them into successful responses.

Required route behavior:

- current runtime routes pass through unchanged;
- `/repobriefs` may retain the application-level permanent redirect to `/repoground`;
- removed routes return the application 404;
- `/health` is not rewritten into a generic proxy health response.

## Verification

Verify the same release across all layers:

1. DNS resolves the canonical internal name;
2. TLS presents the intended internal certificate chain;
3. the reverse proxy selects the Leitstand upstream only for the canonical host;
4. the listener address and owning process match deployment intent;
5. `/health` reports the deployed Git head and expected snapshot contract;
6. removed routes remain unavailable;
7. no direct public listener exists.

A successful proxy response alone does not establish application health or release identity.

## Updates and rollback

Use [Leitstand Gateway Updates](ops.runbook.leitstand-gateway.updates.md) for the release sequence, exact postflight, and bounded rollback. Gateway changes and application releases should remain separate unless one cannot function without the other.
