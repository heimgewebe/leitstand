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
- production binds to `127.0.0.1:3000`;
- Leitstand routes remain read-only;
- source artifacts remain authoritative outside Leitstand;
- the web and storage-health user-systemd units refer to one exact versioned release.

## Canonical deployment entry point

Use `scripts/leitstand-release.py` from an exact clean checkout whose `HEAD`, local required ref, local `origin/main` and live remote `main` all equal the reviewed merge commit. The runtime JSON is based on `deploy/systemd/runtime-config.example.json` and binds the canonical origin plus exact source paths.

The adapter installs `leitstand.service` and `leitstand-storage-health.service` as one transaction. It validates the canonical HTTPS origin during postflight, so a deployment is incomplete when DNS, TLS, Caddy routing or the application route contract disagrees with the target release.

`./scripts/leitstand-up` remains available only for optional Docker/Compose development and testing. LAN mode requires `LEITSTAND_BIND_IP`; it is not the canonical production gateway path.

Do not replace the release adapter with ad hoc unit edits, Compose commands or manual process restarts.

## Routing

The proxy forwards the canonical host to the single Leitstand upstream. It must not publish removed legacy paths through another backend or rewrite them into successful responses.

Required route behavior:

- current runtime routes pass through unchanged;
- `/repobriefs` retains the application-level permanent redirect to `/repoground`;
- removed routes return the application 404;
- `POST /events` returns 404;
- `/health` is not rewritten into a generic proxy health response.

## Verification

The release adapter verifies the same release across all layers:

1. both user-systemd units bind the exact release and expected FragmentPaths;
2. the storage producer succeeds from that release;
3. the web process CWD and loopback listener match deployment intent;
4. local and canonical `/health` report the exact Git head and fresh snapshot contract;
5. active routes return 200 locally and canonically;
6. `/repobriefs` redirects structurally to `/repoground`;
7. removed routes remain 404;
8. TLS and reverse-proxy routing reach the same target without disabling certificate verification.

A successful proxy response alone does not establish application health or release identity.

## Updates and rollback

Use [Local Versioned Release Runtime](local-release-runtime.md) for the exact build, coupled unit transaction, create-only receipts, idempotency and rollback contract. Use [Leitstand Gateway Updates](ops.runbook.leitstand-gateway.updates.md) for gateway-specific changes. Gateway configuration changes and application releases remain separate unless one cannot function without the other.
