#!/usr/bin/env bash
set -eo pipefail

echo "Running Observer Invariant Guard..."

# This script enforces that Leitstand acts as a read-only observer.
# It searches for outgoing POST, PUT, DELETE, PATCH requests in the `src/` directory.

# Find matches for mutating HTTP methods
MATCHES=$(grep -rnI -E "method:[[:space:]]*['\"](POST|PUT|DELETE|PATCH)['\"]" src/ || true)

if [ -z "$MATCHES" ]; then
    echo "✅ No mutating HTTP methods found. Observer invariant is intact."
    exit 0
fi

# Filter out the known exceptions
VIOLATIONS=$(echo "$MATCHES" | grep -v "observer-invariant-guard: allow-known-exception" || true)

if [ -n "$VIOLATIONS" ]; then
    echo "❌ ERROR: Found mutating HTTP methods not marked as known exceptions!"
    echo "Leitstand is an Observer. It should not mutate external state."
    echo ""
    echo "Violations found:"
    echo "$VIOLATIONS"
    echo ""
    echo "If this is a justified exception, mark the line with: // observer-invariant-guard: allow-known-exception"
    exit 1
fi

echo "✅ Observer invariant is intact. (All found methods are allowed exceptions)"
exit 0
