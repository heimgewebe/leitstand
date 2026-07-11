# Leitstand

## Operator ecosystem correction

Leitstand is a read-only observer surface in the new operator ecosystem. Chronik owns event history; Plexer transports bounded operational events; Bureau owns tasks and claims; Grabowski owns local execution and receipts; Heimlern produces learning and proposal reports. Leitstand renders views and digests and does not execute or orchestrate.

This correction is the current role boundary for this repository and supersedes older, incomplete local role lists.

Read-only dashboard, digest and observation surface for the **heimgewebe** operator ecosystem.

## Overview

`leitstand` is the central read-only monitoring and reporting surface for the heimgewebe multi-repo ecosystem. It combines digest generation with browser views for knowledge, fleet and operator-observation artifacts. Execution authority stays with Bureau, Grabowski, Plexer and the runtime operators; Leitstand renders their exported state only.

## Purpose

Leitstand ist das **epistemische Beobachtungs- und Verdichtungsmodul** des Systems.

Er hat genau drei Kernfunktionen:
- Beobachten (Events, Metrics, Insights konsumieren)
- Verdichten (Digests, Zusammenfassungen erzeugen)
- Visualisieren (UI, Views, Reports bereitstellen)

Leitstand ist ausdrücklich **nicht**:
- ein Orchestrator
- eine Steuerinstanz
- eine extern mutierende bzw. gegenüber anderen Systemen schreibende Systemkomponente

Alle Änderungen im Repo müssen dieser Invariante entsprechen.
Lokale Artefaktschreibvorgänge (Caches, Digests, Build-Outputs) sind zulässig, solange sie der reinen Darstellungs- und Observer-Pipeline dienen.

### The Heimgewebe Organism

The heimgewebe organization consists of several interconnected repositories and organs:
- **Bureau**: Task registry, claims and queue truth.
- **Grabowski**: Local execution, worktrees, receipts and operator-side tooling.
- **Plexer**: Bounded operational event transport.
- **Chronik**: Event history and audit/event store.
- **WGX**: Fleet CLI and metrics snapshot generator.
- **semantAH**: Semantic index and daily insights.
- **Heimlern**: Learning/proposal reports from operational friction.
- **metarepo**: Shared contracts, documentation and reusable CI.
- **Leitstand**: This repository — read-only dashboard, digest and operator-observation view surface.

## Security & Public Usage

This repository is designed to be **public**.

- No secrets are stored in this repository
- All sensitive configuration is provided via environment variables (use `.env.example` as a template)
- External schema references are allowlisted by hostname
- Validation is performed against vendored contracts (SSOT)
- CI blocks forbidden file names, not secret content (see `SECURITY.md`)

If you believe a secret has been committed accidentally, report it immediately.
See `SECURITY.md` for reporting details.

## Canonical Deployment

The Leitstand is operated exclusively **internally** under the following host:

**`https://leitstand.heimgewebe.home.arpa`**

This repository is public, but the deployment targets a private network. All security enforcement (firewall, ingress policy) happens outside this repository.

- **Scope:** Deployment on the Heimserver is currently in the development/integration phase; however, the contract (FQDN, internal-only, Proxy/Host-Match) remains normative.
- **Access:** Reachable only via LAN/WireGuard. Externally unavailable (blocked by ingress/firewall policy outside this repo).
- **Contract:** Direct IP access is not part of the contract.

For details, refer to:
- [Runtime Contract](docs/runtime.contract.md) (Normative)
- [Access Matrix](docs/access.matrix.md)
- [Drift Signals](docs/drift.signals.md)

## Features

The daily digest generator combines:

1. **Semantic Insights** from semantAH (`today.json`)
   - Top topics with frequency counts
   - Semantic questions
   - Detected deltas/changes

2. **Events** from chronik (JSONL files)
   - Recent events within a 24-hour window
   - Filtered and sorted by timestamp
   - Support for multiple event types (CI, deploy, etc.)

3. **Fleet Health Metrics** from WGX snapshots
   - Total repository count
   - Status breakdown (ok/warn/fail)
   - Latest metrics timestamp

4. **Operator Observation Snapshots** from Bureau and Grabowski
   - Bureau task/claim lifecycle board (`/bureau`)
   - Checkout/worktree health view (`/checkouts`)
   - Explicitly read-only; no task dispatch or cleanup actions

## WGX Profile

Leitstand intentionally tracks `.wgx/profile.yml` as documented in [WGX Leitstand Decision](docs/decisions/wgx-leitstand.md). The profile is minimal and points WGX at existing pnpm-based checks; it is not an execution-authority grant.

## Ecosystem Map View

Leitstand is the right dashboard surface for a future read-only view of the ecosystem map owned by the Heimgewebe-Systemkatalog. The boundary is documented in [Ecosystem Map View Blueprint](docs/blueprints/ecosystem-map-view.md): The Heimgewebe-Systemkatalog owns map semantics; Leitstand may render and display pinned system catalog Mermaid artifacts with freshness metadata.

## Installation

This project uses [pnpm](https://pnpm.io/) for package management.

```bash
# Enable pnpm (optional if you have it globally)
corepack enable

# Install dependencies (strictly respecting lockfile)
pnpm install --frozen-lockfile

# Build TypeScript
pnpm build

# Start the compiled internal server
pnpm start:server

# Build the static preview/mirror
pnpm build:static
```

## Configuration

Create a `leitstand.config.json` file in your project root:

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

### Configuration Options

- `paths.semantah.todayInsights`: Path to the daily insights JSON file from semantAH
- `paths.chronik.dataDir`: Directory containing JSONL event files from chronik
- `paths.wgx.metricsDir`: Directory containing metrics snapshot JSON files from WGX
- `output.dir`: Output directory for generated digests
- `digest.maxEvents`: Maximum number of events to include in the digest (default: 20)

**Environment Variables**: Paths support environment variable expansion using `$VAR_NAME` syntax.

## Ops Viewer Setup

The **Ops Viewer** (`/ops`) allows operators to view Git health audits directly from the `agent-control-surface` (acs). In the default safe mode it is a strict viewer. A legacy opt-in job fallback may request audit jobs from acs, but that behavior is outside the core Observer Invariant and must not be treated as Leitstand execution authority.

### Naming & Compatibility

The service is officially named `agent-control-surface` (short: **acs**). However, stable interface identifiers retain the legacy `ACS` prefix for compatibility:
- **Environment:** `LEITSTAND_ACS_URL`
- **Headers:** `X-ACS-Viewer-Token`
- **CORS (acs-side):** `ACS_CORS_ALLOW_ORIGINS`

Leitstand acts strictly as a viewer; authentication and authorization enforcement are responsibilities of the acs or its reverse proxy. Exact endpoint paths are defined by the acs API; Leitstand only consumes them.

### Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `LEITSTAND_ACS_URL` | `''` (disabled) | Base URL of the `agent-control-surface`. Must be a valid HTTP/HTTPS URL. |
| `LEITSTAND_OPS_ALLOW_JOB_FALLBACK` | `false` | If `true`, the viewer falls back to triggering async jobs (`POST /api/audit/git`) if the sync endpoint is missing. |
| `LEITSTAND_REPOS` | `metarepo,wgx,leitstand` | Comma-separated list of repositories to display in the selector. |
| `LEITSTAND_ACS_VIEWER_TOKEN` | `undefined` | Optional token sent as `X-ACS-Viewer-Token` header. **Note:** Enforcement depends on acs configuration (e.g., via reverse proxy or middleware); Leitstand merely sends it. |

**Note:** If any environment variable validation fails (e.g., invalid `LEITSTAND_ACS_URL` format), the system falls back to safe defaults (disabling acs integration entirely).

### Deployment & Security Notes

1.  **Mixed Content Warning**:
    If Leitstand is served via **HTTPS**, the browser will block requests to an **HTTP** acs URL.
    - **Fix:** Deploy `agent-control-surface` behind an HTTPS reverse proxy (e.g., Caddy, Nginx) or configure `LEITSTAND_ACS_URL` to use HTTPS.

2.  **CORS Configuration (acs Side)**:
    The `agent-control-surface` must explicitly allow the Leitstand origin to make requests, especially if credentials or cookies are involved.
    - **acs Config:** Ensure `ACS_CORS_ALLOW_ORIGINS` includes your Leitstand URL (e.g., `https://leitstand.internal`).
    - *Avoid using `*` if possible.*

3.  **Viewer vs. Actor**:
    By default (`LEITSTAND_OPS_ALLOW_JOB_FALLBACK=false`), Leitstand only attempts non-mutating fetches (the sync endpoint, if exposed by acs). Enabling fallback allows it to trigger jobs (the job-trigger endpoint, e.g. `POST /api/audit/git`), which is a state-changing action (even if just starting an audit). The UI will display a disclaimer reflecting the current mode. **Crucially, if enabled, Leitstand may *request* an audit job, but authorization and execution remain strictly on the acs side.**

## Data Flow & Contracts

Leitstand is the **visual monitoring center** of the Heimgewebe organism. To provide accurate and stable views, Leitstand relies on clearly defined data contracts and a strict separation of concerns.

```mermaid
flowchart TD
    PLEXER[Plexer<br/>Bounded Events] --> CHRONIK[Chronik<br/>Events / History]
    CHRONIK --> SEMANTAH[semantAH<br/>Semantic Index]
    WGX[WGX<br/>Fleet Metrics] --> LEITSTAND[Leitstand<br/>Read-only Views / Digests]
    SEMANTAH --> LEITSTAND
    CHRONIK --> LEITSTAND
    BUREAU[Bureau<br/>Tasks / Claims Snapshot] --> LEITSTAND
    GRABOWSKI[Grabowski<br/>Checkout Inventory Snapshot] --> LEITSTAND
    HEIMLERN[Heimlern<br/>Learning Proposals] -. future artifact .-> LEITSTAND
    ACS[agent-control-surface<br/>Ops Audit Data] -. optional viewer input .-> LEITSTAND
```

### Roles in the flow

- **Leitstand**: Visualizes state by reading artifacts from `semantAH`, `chronik`, WGX snapshots, Bureau task snapshots and Grabowski checkout snapshots.
- **Bureau**: Owns task and claim truth; Leitstand may render exported `leitstand_bureau_task_snapshot` artifacts.
- **Grabowski**: Owns local execution and worktree/receipt state; Leitstand may render exported `leitstand_checkout_inventory` artifacts.
- **Chronik**: Event log and audit store.
- **Plexer**: Bounded event transport feeding operational event surfaces.
- **semantAH**: Builds the semantic index and writes daily insights.
- **WGX**: Generates fleet metrics snapshots.
- **Heimlern**: Emits learning/proposal reports; Leitstand may later render derived artifacts.
- **agent-control-surface** (acs): Provides operational audit data consumed by the Ops Viewer when configured.

### Central Inputs

The authoritative view of the data streams is documented in `docs/data-flow.md`. The central inputs are:

- `fleet.health` – Fleet health (WGX / metarepo contracts)
- `insights.daily` – Semantic daily insights from semantAH
- `event.line` – Event backbone from Chronik
- `leitstand_bureau_task_snapshot` – Bureau task/claim lifecycle snapshot rendered by `/bureau`
- `leitstand_checkout_inventory` – Grabowski checkout/worktree snapshot rendered by `/checkouts`
- `audit.git.v1` – Ops Viewer data from acs (not part of the Chronik event backbone unless explicitly exported)

### JSON Schemas

The underlying JSON schemas are documented in the **metarepo**:

- `contracts/fleet.health.schema.json`
- `contracts/insights.daily.schema.json`
- `contracts/insights.schema.json`
- `contracts/event.line.schema.json`
- `audit.git.v1` – Currently implemented in acs and mirrored in leitstand types; a metarepo contract is planned.

A curated index of all contracts can be found in `metarepo/docs/contracts-index.md`.

**Note:** New Leitstand features (like the Ops Viewer) fit into this model: they visualize data (artifacts) without violating the authority of generation or mutation (WGX/ACS).

## Usage

### Generate Today's Digest

```bash
# Using the default config file
pnpm daily-digest --config leitstand.config.json

# Or if installed globally
leitstand --config leitstand.config.json
```

### Generate a Digest for a Specific Date

```bash
pnpm daily-digest --config leitstand.config.json --date 2025-12-04
```

### Output

The command generates two files in the output directory:

1. **Markdown file**: `digests/daily/YYYY-MM-DD.md` - Human-readable digest
2. **JSON file**: `digests/daily/YYYY-MM-DD.json` - Structured data for programmatic access

## Development

### Local validation and CI test truth

GitHub CI is the source of truth for the full Vitest suite. The CI workflow runs `pnpm test` on Node 20.

On the Heim-PC, the local Node 22 runtime may crash before application code runs unless Node is started with `NODE_OPTIONS=--jitless`. That workaround is suitable for lint, typecheck and build, but not for full Vitest because Vite/Vitest requires WebAssembly. See [Local Test Runner Compatibility](docs/runbooks/local-test-runner.md).

```bash
# Local Heim-PC preflight when the Node/V8 crash is present
NODE_OPTIONS=--jitless pnpm lint
NODE_OPTIONS=--jitless pnpm typecheck
NODE_OPTIONS=--jitless pnpm build

# Full test suite when the local Node runtime supports it; otherwise rely on CI
pnpm test

# Watch mode when the local Node runtime supports it
pnpm test:watch
```

## Project Structure

```
leitstand/
├── src/
│   ├── config.ts          # Configuration loading and validation
│   ├── insights.ts        # Load semantAH insights
│   ├── events.ts          # Load chronik events
│   ├── metrics.ts         # Load WGX metrics
│   ├── digest.ts          # Combine data sources
│   ├── renderMarkdown.ts  # Render digest to markdown
│   ├── server.ts          # Express server & Ops Viewer
│   ├── views/             # EJS templates (ops, observatory, etc.)
│   └── cli.ts             # CLI entry point
├── tests/
│   ├── config.test.ts
│   ├── ops_integration.test.ts
│   └── ...
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── leitstand.config.json  # Example configuration
```

## Requirements

- Node.js >= 18.0.0
- pnpm >= 8.0.0

## Repository Discovery
- See [AGENTS.md](AGENTS.md) for agentic discovery rules and paths.
- See [docs/index.md](docs/index.md) for the canonical documentation index.

## Future Enhancements

This is the initial iteration focused on generating daily digests and operational views. Future versions may include:

- Real-time metrics streaming
- Historical digest comparison
- Custom alert rules
- Multi-day trend analysis

## License
MIT

## Organism Context

This repository is part of the **Heimgewebe Organism**.

The overarching architecture, axes, roles, and contracts are centrally described in:
👉 [`metarepo/docs/system/heimgewebe-organismus.md`](https://github.com/heimgewebe/metarepo/blob/main/docs/heimgewebe-organismus.md)
and the target vision:
👉 [`metarepo/docs/heimgewebe-zielbild.md`](https://github.com/heimgewebe/metarepo/blob/main/docs/heimgewebe-zielbild.md).

All role definitions, data flows, and contract assignments for this repo are anchored there.
