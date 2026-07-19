---
id: docs.decisions.wgx-leitstand
title: Decision: tracked WGX profile
doc_type: decision
status: active
canonicality: canonical
summary: >
  Keeps Leitstand fleet checks explicit through one minimal tracked WGX profile.
---

# Decision: tracked WGX profile

## Context

Leitstand participates in standardized repository health checks. Omitting its WGX profile would make fleet membership and expected verification ambiguous.

## Decision

Track `.wgx/profile.yml` with explicit `up`, `guard`, and `smoke` tasks. The profile delegates to the repository's pinned pnpm scripts and does not define a second test, deployment, or runtime contract.

## Consequences

- repository health entry points remain predictable;
- the profile is small and reviewable;
- CI and local checks continue to use the package scripts as their implementation;
- WGX success does not establish deployed runtime health, source freshness, or gateway correctness.

Any change to required checks must update the package scripts, CI workflow, WGX profile, and agent guidance consistently.
