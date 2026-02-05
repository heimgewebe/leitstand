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
- No authentication logic
- No secret storage
- No dynamic schema fetching beyond allowlisted references

## CI Limitations
- The security workflow blocks forbidden **file names**, not secret **content**.
- If you accidentally commit a secret in any file, rotate it immediately; assume git history is compromised.
