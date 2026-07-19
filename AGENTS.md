# AGENTS

## Purpose

Leitstand is a read-only dashboard and evidence projection service for the Heimgewebe operator ecosystem. It is not a control plane, task runner, event-ingestion service, or independent source of truth.

## Read This First

1. `README.md`
2. `docs/index.md`
3. `docs/runtime.contract.md`
4. this file

When an observed state requires action, perform that action in the authoritative source system, not through Leitstand.

## Canonical Sources

- `repo.meta.yaml`: repository identity and structure
- `agent-policy.yaml`: change policy
- `docs/index.md`: current documentation router
- `docs/runtime.contract.md`: runtime, route, and health boundary
- `docs/data-flow.md`: artifact and authority flow
- vendored contracts: pinned external schemas

Historical reports and blueprints do not override current contracts.

## Change Rules

- Keep every HTTP surface read-only.
- Do not add mutation, orchestration, authentication, event-ingestion, or task-dispatch routes.
- Do not create a second operational truth model.
- Preserve source identity, contract kind, freshness, and explicit non-claims in projections.
- Use source-specific freshness limits; do not reintroduce one global threshold.
- `/repoground` is canonical; `/repobriefs` is compatibility-only.
- Removed legacy routes must remain unavailable.
- Do not expose internal paths or secrets in browser output.

## Discovery and Generated Files

New canonical documents require frontmatter and discoverability through `docs/index.md`. Critical implementations belong in `audit/impl-registry.yaml`.

`docs/_generated/` contains structural placeholders. Do not edit those files manually.

## Guarded Paths

- `audit/`
- `docs/`
- `scripts/`
- `src/`
- `deploy/`
- `.github/workflows/`

## Required Checks

- repository structure, document relation, generated-file, and drift guards
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- `pnpm build:static`
- `pnpm test:browser-shell`

## Open Gaps

- A systematic accessibility audit beyond current keyboard, focus, ARIA, and responsive-shell regressions remains useful.
- Generated documentation overviews remain placeholders; no second semantic truth generator is planned.
