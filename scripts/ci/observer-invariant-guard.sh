#!/usr/bin/env bash
set -euo pipefail

# Observer Invariant Guard (Heuristic)
#
# NOTICE: This is a heuristic guard. It protects the `src/` directory against 
# obvious new outgoing mutating requests. It is not a complete semantic proof 
# (e.g., AST parsing), but blocks common patterns like `method: 'POST'` or `.post(`.

echo "Running Observer Invariant Guard..."

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT" || { echo "❌ Observer Invariant Guard failed: could not change to repo root." >&2; exit 2; }

set +e
RAW_MATCHES=$(grep -rnI -E "(method:[[:space:]]*['\"](POST|PUT|DELETE|PATCH)['\"]|\.(post|put|delete|patch)[[:space:]]*\()" src/ 2>/dev/null)
SCAN_STATUS=$?
set -e

if [ "$SCAN_STATUS" -gt 1 ]; then
    echo "❌ Observer Invariant Guard failed: error while scanning src/" >&2
    exit "$SCAN_STATUS"
fi

if [ -z "$RAW_MATCHES" ]; then
    echo "✅ No mutating HTTP methods found. Observer invariant is intact."
    exit 0
fi

# Filter out common incoming Express route definitions and explicit known exceptions
VIOLATIONS=$(echo "$RAW_MATCHES" | grep -vE "(app|router)\.(post|put|delete|patch)[[:space:]]*\(" | grep -v "observer-invariant-guard: allow-known-exception" || true)

if [ -n "$VIOLATIONS" ]; then
    echo "❌ Observer Invariant Guard failed: unexpected outbound mutating request pattern detected in src/"
    echo ""
    echo "File/Line violations found:"
    echo "$VIOLATIONS"
    echo ""
    echo "If this is a justified exception, mark the line with: // observer-invariant-guard: allow-known-exception"
    exit 1
fi

echo "✅ Observer invariant is intact. (All found methods are allowed exceptions)"
exit 0
