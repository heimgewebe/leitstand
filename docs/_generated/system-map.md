# Generated System Map

> **Warning: This is a generated file.** Do not edit manually. It outlines the repository zones, entry paths, truth sources, and crucial layers.

## Repository Zones
- `docs/`: Architecture, Decisions, Guides, Runbooks, Reference
- `scripts/`: Operational tools, CLI helpers, and CI enforcement
- `src/`: TypeScript source core for data consumption and UI serving
- `tests/`: Unit and integration testing scope

## Entry Paths
- **Primary Introduction**: `README.md`
- **Agent Boundaries**: `AGENTS.md`
- **Documentation Root**: `docs/index.md`

## Truth Sources
- **Repo Metadata**: `repo.meta.yaml`
- **Agent Constraints**: `agent-policy.yaml`

## Key Implementation Layers
- CLI Entry: `src/cli.ts`
- Server Layer: `src/server.ts`
- Rendering Pipeline: `src/views/`
