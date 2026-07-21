# Leitstand

Leitstand is the read-only observation surface for the Heimgewebe operator ecosystem. It renders bounded artifacts from authoritative source systems and also provides a local digest CLI. It does not orchestrate, dispatch tasks, ingest HTTP events, mutate external systems, or establish a second source of truth.

## Responsibilities

Leitstand has two deliberately separate surfaces.

The canonical general operator status entry is `/`. It is a convenience display over source-owned evidence, not a control plane or a new source of truth. Systemkatalog remains the status-free role catalog; Schauwerk remains the specialized visual/rendering surface.

If Leitstand is unavailable, operators fall back directly to Bureau, Grabowski, runtime health/logs, the Systemkatalog read-only catalog/query surface, RepoGround publications, and specialized Schauwerk views. The outage removes the general display only; it must not block operation.

### Web runtime

The internal Express service renders current exported evidence:

| Route | Purpose | Authority remains with |
| --- | --- | --- |
| `/` | compact source and attention overview | individual source systems |
| `/health` | process, Git, contract, and freshness receipt | current process and local files |
| `/bureau` | task and claim projection | Bureau |
| `/checkouts` | checkout and worktree projection | Grabowski |
| `/storage-health` | bounded storage-health projection | storage-health producer |
| `/ecosystem-map` | verified system relationships | Systemkatalog publication |
| `/repoground` | repository-grounding bundles | RepoGround publication |

`/repobriefs` is a permanent compatibility redirect to `/repoground`.

Removed legacy routes such as `/events`, `/ops`, `/observatory`, `/intent`, `/anatomy`, `/timeline`, `/insights`, and `/reflexion` are not active contracts.

### Digest CLI

The local CLI reads configured files and writes daily digest output. It combines:

1. semantic daily insights from semantAH;
2. recent Chronik events;
3. WGX fleet-health metrics.

These local file writes are report generation, not external mutation or execution authority.

## Authority boundary

- Bureau owns task and claim truth.
- Grabowski owns local execution, worktrees, leases, and receipts.
- Chronik owns event history.
- Plexer transports bounded operational events.
- Systemkatalog owns system purposes and relationships.
- RepoGround owns repository-grounding publications.
- Leitstand only validates, normalizes, summarizes, and renders their exported evidence.

The [Systemkatalog](https://github.com/heimgewebe/systemkatalog) is the cross-system role inventory. Leitstand does not maintain a competing catalog.

## Canonical deployment

The canonical runtime is internal:

`https://leitstand.heimgewebe.home.arpa`

Expected properties:

- HTTPS through the internal reverse proxy;
- no WAN publication;
- exact immutable Git release with commit and tree identity;
- `leitstand.service` and `leitstand-storage-health.service` switched as one rollback-capable transaction;
- create-only deployment receipts and idempotent same-release replay;
- safe application bind on `127.0.0.1:3000`;
- structured local and canonical route readbacks;
- source-specific artifact freshness.

The canonical effect path is `scripts/leitstand-release.py`; host-specific paths come from an exact runtime JSON based on `deploy/systemd/runtime-config.example.json`.

See:

- [Local Versioned Release Runtime](docs/runbooks/local-release-runtime.md)
- [Runtime Contract](docs/runtime.contract.md)
- [Data Flow](docs/data-flow.md)
- [Drift Signals](docs/drift.signals.md)
- [Security Policy](SECURITY.md)
- [Documentation Router](docs/index.md)

## Health semantics

`/health` reports the applied freshness limit for every required source:

| Source | Default limit |
| --- | ---: |
| Bureau snapshot | 20 minutes |
| Checkout snapshot | 20 minutes |
| Storage health | 90 minutes |
| Systemkarte manifest | 168 hours |

A stale source yields `warn`. A missing, unreadable, invalid, or contract-mismatched required source yields `fail` and HTTP 503.

The receipt does not by itself prove DNS, TLS trust, reverse-proxy persistence, external reachability, or source-system correctness.

## Static preview

`pnpm build:static` creates a bounded preview containing only `/`, browser assets, and `_static-boundary.json`.

The manifest records:

- supported static routes;
- runtime-only routes;
- removed routes;
- truths the preview does not establish.

The static preview is not the canonical runtime.

## Installation

Requirements:

- Node.js 20 or newer;
- pnpm 9.1.0 through Corepack.

```bash
corepack enable
corepack prepare pnpm@9.1.0 --activate
pnpm install --frozen-lockfile
pnpm build
```

Start the compiled internal server:

```bash
pnpm start:server
```

Build the static preview:

```bash
pnpm build:static
```

## Digest configuration

Create a `leitstand.config.json` file:

```json
{
  "paths": {
    "semantah": {
      "todayInsights": "$VAULT_ROOT/.gewebe/insights/today.json"
    },
    "chronik": {
      "dataDir": "$VAULT_ROOT/.gewebe/chronik/data"
    },
    "wgx": {
      "metricsDir": "$VAULT_ROOT/.gewebe/wgx/metrics"
    }
  },
  "output": {
    "dir": "digests/daily"
  },
  "digest": {
    "maxEvents": 20
  }
}
```

Configured paths may contain `$VARIABLE` references. Unset variables fail explicitly.

Generate today's digest:

```bash
pnpm daily-digest --config leitstand.config.json
```

Generate a digest for a specific date:

```bash
pnpm daily-digest --config leitstand.config.json --date 2025-12-04
```

The CLI writes one Markdown file and one JSON file to the configured output directory.

## Runtime artifact overrides

The web runtime accepts dedicated read-only artifact path overrides. See `.env.example` for the current names. No event, ACS, Ops, or Observatory environment surface exists.

## Validation

The pull-request quality gates are:

```bash
pnpm check:vendor-contracts
pnpm lint
pnpm typecheck
pnpm test:release-runtime
pnpm test
pnpm test:browser-shell
pnpm build
scripts/ci/repo-structure-guard.sh
scripts/ci/docs-relations-guard.sh
scripts/ci/generated-files-guard.sh
scripts/ci/check-drift-gates.sh
bash scripts/ci/observer-invariant-guard.sh
```

The browser regression verifies the shared shell on mobile and desktop, including focus restoration, responsive navigation, overflow, and the canonical RepoGround route.

## Repository structure

```text
src/
  server.ts          read-only Express runtime
  runtimeHealth.ts   bounded process, Git, and snapshot receipt
  controllers/       artifact validation and view models
  views/             EJS projections
  cli.ts             local digest entry point
  insights.ts        semantAH digest input
  events.ts          Chronik digest input
  metrics.ts         WGX digest input
scripts/
  build-static.mjs   bounded static preview
  ci/                repository and observer guards
docs/
  index.md           canonical documentation router
```

## WGX profile

`.wgx/profile.yml` provides standardized `up`, `guard`, and `smoke` entry points by delegating to the repository's pnpm scripts. It is not an execution-authority grant and does not establish deployed health. See [the WGX decision](docs/decisions/wgx-leitstand.md).

## License

MIT
