#!/usr/bin/env bash
set -euo pipefail

log_info() { echo "→ $1"; }
log_success() { echo "✓ $1"; }
log_error() { echo "❌ $1" >&2; }
fail() { log_error "$1"; exit 1; }

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

log_info "Running Generated Files Guard..."

GENERATED_DIR="docs/_generated"
HEADER="<!-- This is a generated file. Do not edit manually. -->"

REQUIRED_FILES=(
    "doc-index.md"
    "system-map.md"
    "orphans.md"
    "impl-index.md"
    "backlinks.md"
    "supersession-map.md"
    "agent-readiness.md"
)

if [[ ! -d "$GENERATED_DIR" ]]; then
    fail "Required directory '$GENERATED_DIR' is missing."
fi

for filename in "${REQUIRED_FILES[@]}"; do
    file="$GENERATED_DIR/$filename"
    if [[ ! -f "$file" ]]; then
        fail "Required generated file placeholder '$file' is missing."
    fi

    if ! head -n 1 "$file" | grep -Fq "$HEADER"; then
        fail "Generated file '$file' is missing the required warning header on the first line."
    fi
done

log_success "Generated Files Guard passed."
