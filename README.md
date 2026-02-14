# Leitstand

Dashboard and control-room for the **heimgewebe** organism.

## Overview

`leitstand` is the central monitoring and reporting system for the heimgewebe multi-repo ecosystem. In this initial iteration, it provides a **daily system digest generator** that combines data from multiple sources into a unified markdown report.

### The Heimgewebe Organism

The heimgewebe organization consists of several interconnected repositories:
- **metarepo**: Control-plane, contracts, and reusable CI
- **wgx**: Fleet CLI and metrics snapshot generator
- **semantAH**: Semantic index and daily insights
- **chronik**: Event log / audit store (JSONL format)
- **hausKI**: AI orchestrator (writes events to chronik, consumes insights)
- **leitstand**: This repository - dashboard and digest generator

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

Leitstand wird ausschließlich **intern** unter folgendem Host betrieben:

**`https://leitstand.heimgewebe.home.arpa`**

This repository is public, but the deployment targets a private network. All security enforcement (firewall, ingress policy) happens outside this repository.

- Nur via LAN/WireGuard erreichbar.
- Extern nicht verfügbar (durch Ingress/Firewall-Policy außerhalb dieses Repos).
- Direkter IP-Zugriff ist nicht Teil des Contracts.

Refer to [`docs/runtime.contract.md`](docs/runtime.contract.md) for the full contract.

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

## Installation

This project uses [pnpm](https://pnpm.io/) for package management.

```bash
# Enable pnpm (optional if you have it globally)
corepack enable

# Install dependencies (strictly respecting lockfile)
pnpm install --frozen-lockfile

# Start development server
pnpm dev
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

The **Ops Viewer** (`/ops`) allows operators to view Git health audits directly from the `agent-control-surface` (acs). It is designed as a strict viewer but can optionally trigger audit jobs if configured. This integration adheres to the established architectural roles: Leitstand visualizes, acs orchestrates.

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

Leitstand is the **visual control center** of the Heimgewebe organism. To provide accurate and stable views, Leitstand relies on clearly defined data contracts and a strict separation of concerns.

```mermaid
flowchart TD
    FEEDS[aussensensor<br/>Feeds & News] --> CHRONIK[chronik<br/>Events (JSONL)]
    CHRONIK --> SEMANTAH[semantAH<br/>Semantic Index]
    CHRONIK --> LEITSTAND[leitstand<br/>Daily Digest & Ops Viewer]

    SEMANTAH --> LEITSTAND
    WGX[wgx<br/>Fleet Metrics] --> CHRONIK

    LEITSTAND --> HAUSKI[hausKI<br/>Decision Engine]
    HAUSKI --> CHRONIK

    ACS[agent-control-surface] -.-> LEITSTAND
```

### Roles in the flow

- **leitstand**: Visualizes state by reading artifacts from `semantAH` and `chronik`. The Ops Viewer (`/ops`) may additionally fetch live operational data from `agent-control-surface` (acs) when configured.
- **chronik**: Event log and audit store.
- **semantAH**: Builds the semantic index and writes daily insights.
- **wgx**: Generates fleet metrics snapshots.
- **hausKI**: Consumes digests/insights for decision-making.
- **agent-control-surface** (acs): Provides real-time operational state (e.g., Git health audits) consumed by Leitstand's Ops Viewer.

### Central Inputs

The authoritative view of the data streams is documented in `docs/data-flow.md`. The central inputs are:

- `fleet.health` – Fleet health (wgx / metarepo contracts)
- `insights.daily` – Semantic daily insights from semantAH
- `event.line` – Event backbone from chronik
- `audit.git.v1` – Live ops data from acs (Ops Viewer only; not part of chronik event backbone unless explicitly exported)

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

### Run Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch
```

### Type Checking

```bash
pnpm typecheck
```

### Linting

```bash
pnpm lint
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
👉 [`metarepo/docs/heimgewebe-organismus.md`](https://github.com/heimgewebe/metarepo/blob/main/docs/heimgewebe-organismus.md)
and the target vision:
👉 [`metarepo/docs/heimgewebe-zielbild.md`](https://github.com/heimgewebe/metarepo/blob/main/docs/heimgewebe-zielbild.md).

All role definitions, data flows, and contract assignments for this repo are anchored there.
