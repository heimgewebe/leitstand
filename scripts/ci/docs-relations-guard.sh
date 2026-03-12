#!/usr/bin/env bash
set -euo pipefail

log_info() { echo "→ $1"; }
log_success() { echo "✓ $1"; }
log_error() { echo "❌ $1" >&2; }
fail() { log_error "$1"; exit 1; }

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

log_info "Running Docs Relations Guard..."

# Basic check: make sure that files in docs/ (excluding _generated) have frontmatter `---`
# and contain the required fields.
DOC_FILES=$(find docs/ -type f -name "*.md" -not -path "docs/_generated/*" -not -name "index.md")

REQUIRED_FIELDS=(
    "id"
    "title"
    "doc_type"
    "status"
    "canonicality"
    "summary"
)

for file in $DOC_FILES; do
    if ! head -n 1 "$file" | grep -q "^---$"; then
        fail "Markdown document '$file' is missing YAML frontmatter (must start with '---')."
    fi

    # Read frontmatter (between the first two '---' lines)
    FRONTMATTER=$(awk '/^---$/{c++;if(c==2)exit} c==1{print}' "$file")

    for field in "${REQUIRED_FIELDS[@]}"; do
        if ! echo "$FRONTMATTER" | grep -Eq "^${field}:"; then
            fail "Markdown document '$file' is missing required frontmatter field: '$field'."
        fi
    done
done

log_success "Docs Relations Guard passed."
