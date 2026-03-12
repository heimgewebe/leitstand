# AGENTS

## Purpose
This document provides the agentic read path and working boundaries for the `leitstand` repository. It is the primary guide for agents operating within this repository, helping them understand the structure, truth sources, and safe operational boundaries.

## Read This First
1. `repo.meta.yaml` - Defines repository identity, type, and expected artifacts.
2. `docs/index.md` - The canonical entry point for all documentation.
3. `agent-policy.yaml` - Defines safe read, guarded write, and forbidden paths.

## Canonical Sources
- `repo.meta.yaml`: Repo identity and structure truth.
- `AGENTS.md`: Agentic read path and working boundaries.
- `docs/index.md`: Architecture, decisions, reference, guides, runbooks.
- `docs/runtime.contract.md`: Normative invariant for deployment constraints.
- `metarepo`: Canonical schemas for data consumed by Leitstand (e.g., `fleet.health.schema.json`, `insights.daily.schema.json`, `event.line.schema.json`).

## Discovery Rules
The repository uses a discovery mechanism starting from the roots defined in `repo.meta.yaml` (`docs/`, `src/`, `scripts/`, `tests/`, `.github/workflows/`).
- New markdown documents must include YAML frontmatter and be referenced.
- Obsolete documents must be marked `deprecated` or `archived` with explicit `supersedes`/`deprecated_by` relations where applicable.

## Generated Files
Files in `docs/_generated/` are automatically generated overviews and diagnostics. **Do not modify these files manually.** They are produced by generator scripts based on the state of the repository.
- `docs/_generated/doc-index.md`
- `docs/_generated/system-map.md`
- `docs/_generated/orphans.md`
- `docs/_generated/impl-index.md`
- `docs/_generated/backlinks.md`
- `docs/_generated/supersession-map.md`
- `docs/_generated/agent-readiness.md`

## Safe Read Paths
- `README.md`
- `AGENTS.md`
- `docs/`

## Guarded / Risky Paths
- `docs/`
- `scripts/`
- `src/`
- `.github/workflows/`

Changes to these paths require verification, tests, and adherence to policies defined in `agent-policy.yaml`.

## Required Checks
Before submitting patches, the following checks must pass:
- `repo-structure-guard`
- `docs-relations-guard`
- `generated-files-guard`
- `pnpm lint`
- `pnpm test`
- `pnpm typecheck`

## Common Traps
- **Missing Frontmatter:** Ensure all `.md` files in `docs/` (excluding `_generated/` and `index.md` if not applicable) have valid frontmatter.
- **Manual Edits to Generated Files:** Do not edit `docs/_generated/` manually.
- **Ignoring Event.line schemas:** Do not assume missing data can be mocked incorrectly; use valid schemas.
- **Modifying Artifacts:** Edit source files, not generated static sites or dist folders.

## Open Gaps
- Implicit dependencies between deployment scripts and runbooks are tracked heuristically.
- Full automated test coverage of the frontend UI rendering logic is sparse.
