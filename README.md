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
- All sensitive configuration is provided via environment variables (use `.env.example` or `.env.template` as a template)
- External schema references are allowlisted by hostname
- Validation is performed against vendored contracts (SSOT)
- CI blocks forbidden file names, not secret content (see `SECURITY.md`)

If you believe a secret has been committed accidentally, report it immediately.
See `SECURITY.md` for reporting details.

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

The **Ops Viewer** (`/ops`) allows operators to view Git health audits directly from the Agent Control Surface (ACS). It is designed as a strict viewer but can optionally trigger audit jobs if configured. This integration adheres to the established architectural roles: Leitstand visualizes, ACS orchestrates (see "Data Flow & Contracts" below).

### Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `LEITSTAND_ACS_URL` | `''` (disabled) | Base URL of the Agent Control Surface. Must be a valid HTTP/HTTPS URL. |
| `LEITSTAND_OPS_ALLOW_JOB_FALLBACK` | `false` | If `true`, the viewer falls back to triggering async jobs (`POST /api/audit/git`) if the sync endpoint is missing. |
| `LEITSTAND_REPOS` | `metarepo,wgx,leitstand` | Comma-separated list of repositories to display in the selector. |
| `LEITSTAND_ACS_VIEWER_TOKEN` | `undefined` | Optional token sent as `X-ACS-Viewer-Token` header. **Note:** Enforcement depends on ACS configuration (e.g., via reverse proxy or middleware); Leitstand merely sends it. |

**Note:** If any environment variable validation fails (e.g., invalid ACS URL format), the system falls back to safe defaults (disabling ACS integration entirely).

### Deployment & Security Notes

1.  **Mixed Content Warning**:
    If Leitstand is served via **HTTPS**, the browser will block requests to an **HTTP** ACS URL.
    - **Fix:** Deploy ACS behind an HTTPS reverse proxy (e.g., Caddy, Nginx) or configure `LEITSTAND_ACS_URL` to use HTTPS.

2.  **CORS Configuration (ACS Side)**:
    The ACS must explicitly allow the Leitstand origin to make requests, especially if credentials or cookies are involved.
    - **ACS Config:** Ensure `ACS_CORS_ALLOW_ORIGINS` includes your Leitstand URL (e.g., `https://leitstand.internal`).
    - *Avoid using `*` if possible.*

3.  **Viewer vs. Actor**:
    By default (`ALLOW_JOB_FALLBACK=false`), Leitstand only attempts non-mutating fetches (`GET /sync` or `GET /latest`). Enabling fallback allows it to trigger jobs, which is a state-changing action (even if just starting an audit). The UI will display a disclaimer reflecting the current mode.

## Data Flow & Contracts

Leitstand is the **visual control center** of the Heimgewebe organism.
To provide accurate and stable views, Leitstand relies on clearly defined data contracts.

The authoritative view of the data streams consumed by Leitstand is documented in:

- `docs/data-flow.md`

The central inputs described there are:

- `fleet.health` – Fleet health (wgx / metarepo contracts)
- `insights.daily` – Semantic daily insights from semantAH
- `event.line` – Event backbone from chronik

The underlying JSON schemas are documented in the **metarepo**:

- `contracts/fleet.health.schema.json`
- `contracts/insights.daily.schema.json`
- `contracts/insights.schema.json`
- `contracts/event.line.schema.json`

Eine kuratierte Übersicht aller Contracts findet sich im metarepo unter:

- `docs/contracts-index.md`

Hinweis:

- Neue Leitstand-Features (wie der Ops Viewer) fügen sich in dieses Modell ein: Sie visualisieren Daten (Artefakte), ohne die Hoheit über die Erzeugung oder Mutation (WGX/ACS) zu verletzen.

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

Example markdown output:

```markdown
# Heimgewebe Digest – 2025-12-05

Generated: 2025-12-05T15:30:00Z

## Top Topics

- **TypeScript** (15)
- **Testing** (10)
- **CI/CD** (8)

## Key Events (last 24h)

- `10:30:00` ci.success heimgewebe/wgx test
- `09:15:00` ci.failure heimgewebe/semantAH build [high]

## Fleet Health

**Total Repositories:** 5

**Status Breakdown:**
- ✅ OK: 3
- ⚠️  Warning: 1
- ❌ Failed: 1

_Last updated: 2025-12-05 12:00:00_
```

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
│   └── cli.ts             # CLI entry point
├── tests/
│   ├── config.test.ts
│   ├── insights.test.ts
│   ├── events.test.ts
│   ├── metrics.test.ts
│   ├── digest.test.ts
│   ├── renderMarkdown.test.ts
│   ├── integration.test.ts
│   └── fixtures/          # Test data
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── leitstand.config.json  # Example configuration
```

## Data Contracts (Legacy View)

### Daily Insights (semantAH)

Expected shape of `today.json`:

```typescript
{
  ts: "YYYY-MM-DD",
  topics: [["topic", count], ...],
  questions: ["question 1", ...],
  deltas: ["change 1", ...]
}
```

### Events (chronik)

JSONL files with one event per line:

```typescript
{
  timestamp: "ISO-8601",
  kind: "event.type",
  repo?: "owner/repo",
  job?: "job-name",
  severity?: "low|medium|high",
  payload?: { ... }
}
```

### Metrics (WGX)

JSON snapshot files:

```typescript
{
  timestamp: "ISO-8601",
  repoCount: number,
  status: {
    ok: number,
    warn: number,
    fail: number
  },
  metadata?: { ... }
}
```

## Requirements

- Node.js >= 18.0.0
- pnpm >= 8.0.0

## Future Enhancements

This is the initial iteration focused on generating daily digests. Future versions may include:

- Web UI for interactive dashboard
- Real-time metrics streaming
- Historical digest comparison
- Custom alert rules
- Multi-day trend analysis
- Integration with hausKI for AI-powered insights

## License
MIT

## Heimgewebe Data Flow

This section shows how `leitstand` fits into the wider Heimgewebe organism.

```mermaid
flowchart TD

    FEEDS[aussensensor<br/>Feeds & News] --> CHRONIK[chronik<br/>Events (JSONL)]

    CHRONIK --> SEMANTAH[semantAH<br/>Semantic Index<br/>Daily Insights]
    CHRONIK --> LEITSTAND[leitstand<br/>Daily Digest Generator]

    SEMANTAH --> LEITSTAND

    LEITSTAND --> HAUSKI[hausKI<br/>Decision Engine]
    HAUSKI --> CHRONIK
```

### Roles in the flow

- **aussensensor**
  Curated external feeds. Writes events into `chronik` as JSONL.

- **chronik**
  Event log and audit store. Each domain (for example `metrics.snapshot`) maps to one JSONL file in `CHRONIK_DATA_DIR`.

- **semantAH**
  Builds and updates the semantic index and writes **daily insights** to:
  - `$VAULT_ROOT/.gewebe/insights/today.json`
  - `$VAULT_ROOT/.gewebe/insights/daily/YYYY-MM-DD.json`

- **wgx** (not drawn explicitly)
  Generates fleet metrics snapshots which are stored in `chronik` as `metrics.snapshot` events and exported to:
  - `$VAULT_ROOT/.gewebe/wgx/metrics/YYYY-MM-DD.json`
  - `$VAULT_ROOT/.gewebe/wgx/metrics/latest.json`

- **leitstand**
  Reads three main inputs:
  1. Daily insights from semantAH (`today.json`),
  2. recent events from chronik (JSONL files),
  3. fleet health metrics from WGX snapshots.

  It combines them into a single daily digest (Markdown + JSON) that can be used as a dashboard, email, or further automation input.

- **hausKI**
  Consumes digests and insights as part of its decision-making, and writes decisions and outcomes back into `chronik`, closing the loop.

In short: `leitstand` is the place where the organism looks at itself once per day and formulates a coherent story about its current state.

## Organism Context

This repository is part of the **Heimgewebe Organism**.

The overarching architecture, axes, roles, and contracts are centrally described in:
👉 [`metarepo/docs/heimgewebe-organismus.md`](https://github.com/heimgewebe/metarepo/blob/main/docs/heimgewebe-organismus.md)
and the target vision:
👉 [`metarepo/docs/heimgewebe-zielbild.md`](https://github.com/heimgewebe/metarepo/blob/main/docs/heimgewebe-zielbild.md).

All role definitions, data flows, and contract assignments for this repo are anchored there.
