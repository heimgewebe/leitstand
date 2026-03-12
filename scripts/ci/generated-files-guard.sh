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

if [[ -d "$GENERATED_DIR" ]]; then
    FILES=$(find "$GENERATED_DIR" -type f -name "*.md")
    for file in $FILES; do
        if ! grep -Fq "$HEADER" "$file"; then
            fail "Generated file '$file' is missing the required warning header."
        fi
    done
fi

log_success "Generated Files Guard passed."
