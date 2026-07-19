---
id: docs.DEPLOYMENT
title: Deployment
doc_type: guide
status: active
canonicality: canonical
summary: >
  Deployment
---

# Deployment

## Artifact Ingestion

The `leitstand` build process is designed to be resilient to missing upstream data.

## Events Ingestion

Leitstand can ingest events (e.g., `knowledge.observatory.published.v1`) via the `/events` endpoint.

**Security & Authorization:**

The endpoint is protected to prevent unauthorized triggers.

*   **Production:** Authorization is **required**. The endpoint is disabled (403) if no token is configured.
*   **Dev/Preview:** Authorization is **optional**. If no token is configured, the endpoint is open (permissive).

**Configuration:**

| Variable | Description | Default / Required |
| :--- | :--- | :--- |
| `LEITSTAND_EVENTS_TOKEN` | Secret token to authorize event ingestion. | **Required in Prod** |
| `LEITSTAND_STRICT` | If `1`, enables strict mode (fail-loud). Also enforces token requirement on `/events`. | `0` (Dev), `1` (Prod) |

**Usage:**

Requests must include the token in headers:

*   `Authorization: Bearer <token>`
*   `X-Events-Token: <token>`
