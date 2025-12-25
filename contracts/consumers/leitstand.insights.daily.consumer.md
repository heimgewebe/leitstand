# Consumer Contract: Leitstand - Insights Daily

**Consumer:** `leitstand`
**Subject:** `insights.daily.json`
**Status:** Active

## 1. The Core Conflict

There are two competing sources of truth for what constitutes the "latest" Daily Insight:
1.  **Transport Truth:** The artifact pointed to by the `insights-daily` GitHub Release tag.
2.  **Artifact Truth:** The artifact with the highest `metadata.generated_at` timestamp.

## 2. Canonical Freshness Rule

Leitstand explicitly resolves this conflict in favor of **Artifact Truth**.

**The Rule:**
Leitstand consumes `insights.daily.json` according to the following precedence:

1.  **Primary Order:** `metadata.generated_at` (ISO 8601).
    *   *The artifact with the most recent `generated_at` is the semantic latest.*
2.  **Secondary Order:** `ts` (YYYY-MM-DD).
    *   *Used for coarse-grained sorting if full timestamp is missing.*
3.  **Transport is NOT Canonical:**
    *   GitHub Release Tags, URLs, or file system modification times (`mtime`) are purely transport mechanisms. They define *availability*, not *currency*.

## 3. Fallback Behavior

If the artifact lacks valid time metadata:
1.  Leitstand MUST log a warning.
2.  Leitstand MAY fall back to transport time (e.g., file creation time) as a last resort.
3.  This degraded state MUST be visible in the system (logs or UI).

## 4. UI Obligations

The User Interface (e.g., `/observatory`) MUST:
1.  Display the source of the data's freshness (i.e., the `generated_at` date).
2.  Explicitly indicate if the data source is a fallback (e.g., "Fixture" or "Legacy").

## 5. Rationale

Defining truth within the artifact ensures:
*   **Decoupling:** Leitstand is not bound to GitHub's specific release semantics.
*   **Time Travel:** Historical analysis and backfills work natively without faking release tags.
*   **Consistency:** `heimlern` and `chronik` can use the exact same logic.
