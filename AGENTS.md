# AGENTS

## Purpose
This repository provides the dashboard and control-room for the heimgewebe organism (daily system digest generator). It is a Type B — Produkt-/Service-Repo.

## Read This First
- **Primary read path**: Start with `README.md` and this `AGENTS.md` file. Then review `docs/index.md` for normative invariants and runbooks.
- Understand that this is a UI / Observer: it does not generate raw insights and does not execute motorik actions.
- If actions are required, Leitstand may **request** them explicitly via the agent-control-surface (acs), but authorization and execution remain outside Leitstand.

## Canonical Sources
- `repo.meta.yaml` (Repo identity and structure truth)
- `AGENTS.md` (Agent reading path and working boundaries)
- `agent-policy.yaml` (Change policies and rules)
- `docs/index.md` (Canonical documentation router)
- Vendored contracts from metarepo

## Discovery Rules
All new documents and critical implementations must be discoverable:
- Markdown documents must have appropriate frontmatter.
- Generated overviews must list them.
- Critical implementations must be registered in `audit/impl-registry.yaml`.

## Generated Files
- `docs/_generated/` currently contains structural placeholders for overviews (`doc-index.md`, `system-map.md`, `orphans.md`, etc.).
- A full semantic graph generator is not yet active.
- Generated files must **not** be manually edited, to preserve the placeholder structure.

## Safe Read Paths
- `README.md`
- `AGENTS.md`
- `repo.meta.yaml`
- `agent-policy.yaml`
- `audit/`
- `docs/`

## Guarded / Risky Paths
- `audit/`
- `docs/` (Except generated content)
- `scripts/`
- `src/`
- `deploy/`
- `.github/workflows/`

## Required Checks
- `repo-structure-guard`
- `docs-relations-guard`
- `generated-files-guard`
- `check-drift-gates`
- `lint` and `test` (pnpm run lint, pnpm test)

## Common Traps
- Hardcoding data paths: Use flexible loading logic that prioritizes filename timestamps over mtime.
- Modifying external schemas: The schema logic relies on canonical vendored schemas.
- Empty `catch` blocks: Ensure explicit `// Ignore ENOENT` comments are added when ignoring ENOENT errors.

## Open Gaps

Anchored on `docs/blueprints/leitstand_visualization.md`. Items listed as `[ ]` or
`[~]` there are the canonical source — this list mirrors the highest-impact ones
so agents can pick up work without re-reading the full roadmap.

- **Phase 0/1 governance**: Scope, source inventory and DoD checklist still need
  to be formally documented (`docs/blueprints/leitstand_visualization.md` §0-§1).
- **Phase 4/5 Vortagsvergleich**: ✅ Umgesetzt — die Erkenntnisse-Ansicht bindet
  das konkrete Vortags-Artefakt (`insights.daily.<YYYY-MM-DD>.json`) und berechnet
  ein strukturiertes Delta (Topics/Fragen). Verbleibende Abhängigkeit: produzentseitige
  Bereitstellung datierter Vortags-Artefakte im Echtbetrieb (Dev/Fixture deckt es ab).
- **Phase 6 Reflexion-Producer-Contract**: Producer-Contract für
  `heimgeist.reflexion.bundle.v1` ist im Leitstand defensiv geprüft, aber noch
  nicht End-to-End mit dem Producer-Repo abgestimmt.
- **Phase 7 Cross-View-Navigation**: Filter-/Kontextübergaben zwischen
  Zeitachse, Anatomie und Erkenntnissen sind noch nicht vollständig (Drilldown
  ist erst per-Insight implementiert).
- **Phase 7 Responsives Verhalten**: Mobile-Layouts der Kernansichten sind nur
  punktuell geprüft (z. B. Topic-Liste in `insights.ejs`).
- **Phase 7 Accessibility**: Tastaturfokus und ARIA sind partiell vorhanden
  (Home, Timeline); ein systematischer A11y-Sweep über alle Views steht aus.
- **Phase 8 Tests**: Visualmodell- und Mapping-Tests werden Phase für Phase
  ergänzt – derzeit liegen Schwerpunkte bei Controller- und Server-Tests.
- **Semantic Graph Generator** (`docs/_generated/`): Die generierten Übersichten
  sind aktuell Platzhalter; ein echter Generator ist nicht vorgesehen.
