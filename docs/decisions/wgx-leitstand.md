# Decision: leitstand has a tracked WGX profile

## Context
`leitstand` is part of the Heimgewebe fleet (`heimgewebe.fleet.enabled: true`).

Historically, it carried a "NO_PROFILE" marker to express "observer by design".
In practice, missing `.wgx/profile.yml` is a recurring source of noise:
tools (repo health checks, repolens/rLens) surface it as drift and CI tooling
expects a tracked profile for standardized motorik.

## Decision
We track `.wgx/profile.yml` in `leitstand` and set:
- `profile_expected: true`
- `guard_smoke_expected: true`

The profile is intentionally minimal and uses pnpm scripts if present.

## Consequences
Pros:
- fleet consistency: "Fleet=yes -> Profile yes"
- fewer false positives in health tooling
- standardized entry points: `wgx guard`, `wgx smoke`

Cons:
- requires Node + pnpm (via Corepack) for meaningful execution
