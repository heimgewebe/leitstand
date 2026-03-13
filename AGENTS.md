# AGENTS

## Purpose
This repository provides the dashboard and control-room for the heimgewebe organism (daily system digest generator). It is a Type B — Produkt-/Service-Repo.

## Read This First
- **Primary read path**: Start with `README.md` and this `AGENTS.md` file. Then review `docs/index.md` for normative invariants and runbooks.
- Understand that this is a UI / Observer. It does not generate raw insights or execute motorik actions (except for self-healing).

## Canonical Sources
- `repo.meta.yaml` (Repo identity and structure truth)
- `AGENTS.md` (Agent reading path and working boundaries)
- `docs/index.md` (Canonical documentation router)
- Vendored contracts from metarepo

## Discovery Rules
All new documents and critical implementations must be discoverable:
- Markdown documents must have appropriate frontmatter.
- Generated overviews must list them.
- Critical implementations must be registered in `audit/impl-registry.yaml`.

## Generated Files
- `docs/_generated/` contains generated overviews (`doc-index.md`, `system-map.md`, `orphans.md`, etc.).
- Generated files must **not** be manually edited.

## Safe Read Paths
- `README.md`
- `AGENTS.md`
- `docs/`
- `repo.meta.yaml`

## Guarded / Risky Paths
- `docs/` (Except generated content)
- `scripts/`
- `src/`
- `deploy/`
- `.github/workflows/`

## Required Checks
- `repo-structure-guard`
- `docs-relations-guard`
- `generated-files-guard`
- `lint` and `test` (pnpm run lint, pnpm test)

## Common Traps
- Hardcoding data paths: Use flexible loading logic that prioritizes filename timestamps over mtime.
- Modifying external schemas: The schema logic relies on canonical vendored schemas.
- Empty `catch` blocks: Ensure explicit `// Ignore ENOENT` comments are added when ignoring ENOENT errors.

## Open Gaps
- TBD
