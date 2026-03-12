# AGENTS

## Purpose
Provides agentic reading boundaries, instructions, and limits for navigating and modifying this repository.

## Read This First
The Leitstand is the central monitoring UI of the Heimgewebe organism. It primarily views data (artifacts) and produces reports without executing mutating actions unless explicitly acting as a proxy viewer (e.g., Ops Viewer).

## Canonical Sources
- `repo.meta.yaml` - Repository identity and structural truth.
- `AGENTS.md` - Agentic read path and working boundaries.
- `docs/index.md` - Documentation entry point.

## Discovery Rules
All new documents and implementations must be discoverable and accurately registered according to the metadata rules described in the repository blueprint.
- All `.md` documents in `docs/` require frontmatter.
- Implementations require explicit tests.

## Generated Files
Files in `docs/_generated/` are automatically generated and MUST NOT be edited manually. They provide diagnostic overviews.

## Safe Read Paths
- `README.md`
- `AGENTS.md`
- `docs/`

## Guarded / Risky Paths
- `docs/` (write requires verification of link integrity)
- `scripts/` (especially deploy or CI scripts)
- `src/` (requires tests passing and code review)
- `.github/workflows/`

## Required Checks
- `repo-structure-guard`
- `docs-relations-guard`
- `generated-files-guard`
- `lint`
- `test`

## Common Traps
- Misinterpreting UI visualization changes as mutations of underlying states.
- Editing `docs/_generated/` files instead of regenerating them.
- Omitting frontmatter in new Markdown documents in `docs/`.

## Open Gaps
- Implicit dependencies on specific data shapes without explicit schema assertions in test data.
