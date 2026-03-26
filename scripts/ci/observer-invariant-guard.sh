#!/usr/bin/env bash
set -euo pipefail

# Observer Invariant Guard (Heuristic)
#
# NOTICE: This is a heuristical guard. It protects the `src/` directory against 
# obvious new outgoing mutating requests. It is not a complete semantic proof 
# (e.g., AST parsing), but blocks common patterns like `method: 'POST'` or `.post(`.

echo "Running Observer Invariant Guard..."

# Find matches for mutating HTTP methods, excluding common incoming Express route definitions (app.post, router.post)
MATCHES=$(grep -rnI -E "(method:[[:space:]]*['\"](POST|PUT|DELETE|PATCH)['\"]|\.(post|put|delete|patch)\()" src/ | grep -vE "(app|router)\.(post|put|delete|patch)\(" || true)

if [ -z "$MATCHES" ]; then
    echo "✅ No mutating HTTP methods found. Observer invariant is intact."
    exit 0
fi

# Filter out the known exceptions explicitly marked in code
VIOLATIONS=$(echo "$MATCHES" | grep -v "observer-invariant-guard: allow-known-exception" || true)

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
