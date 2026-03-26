# Security Policy

## Supported Scope
This repository intentionally contains **no secrets**.
All sensitive configuration must be provided via environment variables.

## Reporting a Vulnerability
If you discover a security issue, **do not open a public issue**.

Please report privately via:
- GitHub Security Advisories
- or direct contact with the maintainers

## Non-Goals
- No user/session authentication logic (no accounts, no login flows)
- POST `/events` has an optional token guard: if `LEITSTAND_EVENTS_TOKEN` is set, the token is required; otherwise the route is disabled in strict mode or only accepts unauthenticated requests from localhost (remote requests are blocked).
- No secret storage
- No dynamic schema fetching beyond allowlisted references

## CI Limitations
- The security workflow blocks forbidden **file names**, not secret **content**.
- If you accidentally commit a secret in any file, rotate it immediately; assume git history is compromised.
