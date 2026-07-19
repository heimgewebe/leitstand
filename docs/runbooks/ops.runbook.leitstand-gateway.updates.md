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

This runbook separates application release effects from gateway configuration effects. Leitstand has no companion ACS service, mutation endpoint, or event-ingestion dependency.

Application releases use `scripts/leitstand-release.py`; gateway changes remain explicit Caddy, DNS or TLS work and are not bundled into the release transaction.

## Preconditions

Before an application update, record:

- exact reviewed merge commit and source tree;
- current web and storage-health unit identities;
- current release and process CWD;
- current local and canonical `/health` receipts;
- listener address and owning process;
- runtime configuration digest;
- previous managed release or first-cutover unit snapshots.

Do not update when the source checkout is dirty; when `HEAD`, the local required ref, local `origin/main` and live remote `main` disagree; when release identity is ambiguous; when runtime configuration is invalid; or when port 3000 belongs to an unrelated process.

## Application update

Use the coupled adapter with a runtime file based on `deploy/systemd/runtime-config.example.json`:

```bash
python3 scripts/leitstand-release.py deploy \
  --source-repo /path/to/exact-checkout \
  --expected-head <merge-commit> \
  --runtime-config ~/.config/leitstand/runtime.json
```

The adapter builds one sealed release, switches `leitstand.service` and `leitstand-storage-health.service` together, runs the storage producer and performs local plus canonical readbacks. Do not combine the rollout with unrelated pulls, cleanup, gateway changes or dependency upgrades.

`./scripts/leitstand-up` and `LEITSTAND_BIND_IP` apply only to the optional Docker/Compose development path.

## Application postflight

A deployment succeeds only when the adapter receipt proves:

1. both units bind the exact target release and expected FragmentPaths;
2. the storage producer exits successfully;
3. the web process is active, stable and loopback-only;
4. local and canonical `/health` report the intended Git head and fresh source-specific snapshots;
5. all active routes respond with 200 locally and canonically;
6. `/repobriefs` redirects structurally to `/repoground`;
7. `POST /events` and every removed legacy route return 404;
8. create-only receipt and completion hashes pass readback;
9. no unrelated process, unit or checkout changed.

## Rollback

Any failed write, reload, producer run, restart or postflight triggers automatic restoration of both previous unit files and release selectors. The adapter reloads systemd, reruns the previous storage producer and restarts the previous web service.

After a successful managed deployment, use the recorded previous release or an explicit verified commit through the adapter's `rollback` command. During first cutover, the prior unmanaged release path, both unit hashes and the create-only backup paths remain in the deployment receipt; the adapter does not invent or copy a legacy release tree.

If restoration is incomplete, stop further automatic attempts and preserve receipts, unit files, release directories, process evidence and journals for diagnosis.

## Gateway changes

DNS, TLS or Caddy changes require their own reviewed change and independent readback. A successful application deployment does not authorize or prove gateway persistence beyond the canonical HTTPS requests observed during postflight.

## Drift rule

Any change to the release adapter, unit templates, runtime configuration, listener policy, health contract or route set must update [Local Versioned Release Runtime](local-release-runtime.md). Compose changes must update this gateway runbook.
