#!/usr/bin/env bash
set -euo pipefail

# Observer Invariant Guard (Heuristic)
#
# NOTICE: This is a heuristic guard. It protects the `src/` directory against 
# obvious new outgoing mutating requests. It is not a complete semantic proof 
# (e.g., AST parsing), but blocks common patterns like `method: 'POST'` or `.post(`.

echo "Running Observer Invariant Guard..."

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT" || { echo "❌ Observer Invariant Guard failed: could not change to repo root." >&2; exit 2; }

# Disable errexit temporarily because grep exits 1 if no matches are found
set +e

# Step 1: Scan for all potential mutating HTTP methods
RAW_MATCHES=$(grep -rnI -E "(method:[[:space:]]*['\"](POST|PUT|DELETE|PATCH)['\"]|\.(post|put|delete|patch)[[:space:]]*\()" src/)
SCAN_STATUS=$?

set -e

if [ "$SCAN_STATUS" -gt 1 ]; then
    echo "❌ Observer Invariant Guard failed: error while scanning src/" >&2
    exit "$SCAN_STATUS"
fi

if [ "$SCAN_STATUS" -eq 1 ] || [ -z "$RAW_MATCHES" ]; then
    echo "✅ No mutating HTTP methods found. Observer invariant is intact."
    exit 0
fi

# Step 2: Filter out common incoming Express route definitions
set +e
MATCHES=$(echo "$RAW_MATCHES" | grep -vE "(app|router)\.(post|put|delete|patch)[[:space:]]*\(")
FILTER_EXPRESS_STATUS=$?
set -e

if [ "$FILTER_EXPRESS_STATUS" -gt 1 ]; then
    echo "❌ Observer Invariant Guard failed: error while filtering express patterns." >&2
    exit "$FILTER_EXPRESS_STATUS"
fi

if [ -z "$MATCHES" ]; then
    echo "✅ No mutating HTTP methods found. Observer invariant is intact."
    exit 0
fi

# Step 3: Filter out explicit known exceptions
set +e
VIOLATIONS=$(echo "$MATCHES" | grep -v "observer-invariant-guard: allow-known-exception")
FILTER_EXCEPTIONS_STATUS=$?
set -e

if [ "$FILTER_EXCEPTIONS_STATUS" -gt 1 ]; then
    echo "❌ Observer Invariant Guard failed: error while filtering known exceptions." >&2
    exit "$FILTER_EXCEPTIONS_STATUS"
fi

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
