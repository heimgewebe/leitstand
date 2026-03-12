#!/usr/bin/env bash
set -euo pipefail

log_info() { echo "→ $1"; }
log_success() { echo "✓ $1"; }
log_error() { echo "❌ $1" >&2; }
fail() { log_error "$1"; exit 1; }

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

log_info "Running Repo Structure Guard..."

FILES=(
    "repo.meta.yaml"
    "docs/index.md"
)

for file in "${FILES[@]}"; do
    if [[ ! -f "$file" ]]; then
        fail "Required core artifact '$file' is missing."
    fi
done

if [[ ! -d "docs/_generated" ]]; then
    fail "Required directory 'docs/_generated' is missing."
fi

log_success "Repo Structure Guard passed."
