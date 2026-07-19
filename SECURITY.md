# Security Policy

## Supported Scope

Leitstand is a read-only projection service. It exposes browser views and a local health receipt, but no mutation, orchestration, task-dispatch, event-ingestion, authentication, or secret-storage surface.

Sensitive runtime configuration must remain outside the repository and be supplied by the deployment environment.

## Reporting a Vulnerability

Do not open a public issue for a security vulnerability. Use GitHub Security Advisories or contact the maintainers privately.

## Security Boundaries

- No accounts, sessions, or login flows.
- No state-changing HTTP routes.
- No event-ingestion endpoint; `POST /events` is intentionally unhandled and returns 404.
- No secret storage.
- No dynamic schema fetching at runtime.
- External truth remains owned by Bureau, Grabowski, Systemkatalog, RepoGround, and their source artifacts.

## CI Limitations

The security workflow cannot prove that arbitrary file content contains no secret. Rotate any accidentally committed secret immediately and treat Git history as compromised.
