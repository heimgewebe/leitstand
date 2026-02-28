#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

log_info() { echo "→ $1"; }
log_success() { echo "✓ $1"; }
log_error() { echo "❌ $1" >&2; }
fail() { log_error "$1"; exit 1; }

log_info "Running Drift Gates Checks..."

# 1. Doc Link Integrity Check
log_info "1. Checking Doc Link Integrity..."
if [[ ! -f "docs/index.md" ]]; then
    fail "docs/index.md is missing. It must act as the documentation router."
fi

# Extract links from docs/index.md (rudimentary regex for markdown links)
# Format: [Text](Path)
# Note: uses awk to parse the link robustly across grep implementations (avoiding -P)
awk '
  {
    while(match($0, /\[[^]]+\]\([^)]+\)/)) {
      link_full = substr($0, RSTART, RLENGTH)
      match(link_full, /\([^)]+\)/)
      link = substr(link_full, RSTART+1, RLENGTH-2)
      print link
      $0 = substr($0, RSTART + RLENGTH)
    }
  }
' docs/index.md | while read -r link; do
    # Strip any anchors if present
    file_path="${link%%#*}"
    if [[ ! -f "docs/$file_path" ]]; then
        fail "docs/index.md contains a broken link: $link (resolved to docs/$file_path)"
    fi
done

# Check if drift.signals.md links to runtime.contract.md
if ! grep -q "\](runtime.contract.md)" docs/drift.signals.md; then
    fail "docs/drift.signals.md must contain a markdown link to runtime.contract.md for the Contract-Check flow."
fi

log_success "Doc Link Integrity Passed."

# Identify modified files depending on context
# 1. Local dirty tree (developer running script before commit)
MODIFIED_FILES=$(git diff --name-only HEAD || git ls-files --modified)
# 2. GH Actions: pull_request
if [[ -n "${GITHUB_BASE_REF:-}" ]]; then
    MODIFIED_FILES=$(git diff --name-only "origin/$GITHUB_BASE_REF" HEAD || true)
# 3. GH Actions: push
elif [[ -n "${GITHUB_SHA:-}" && "${GITHUB_EVENT_NAME:-}" == "push" ]]; then
    # We diff against the previous commit. GITHUB_SHA is the current commit.
    MODIFIED_FILES=$(git diff-tree --no-commit-id --name-only -r "$GITHUB_SHA" || true)
fi

log_info "Modified files to check against gates:"
echo "$MODIFIED_FILES"

# 2. Vendored Contracts Consistency
log_info "2. Checking Vendored Contracts Consistency..."
if echo "$MODIFIED_FILES" | grep -q "scripts/vendor-contracts.mjs"; then
    log_info "scripts/vendor-contracts.mjs was modified."
    if ! echo "$MODIFIED_FILES" | grep -q "vendor/contracts/_pin.json"; then
        fail "scripts/vendor-contracts.mjs was modified, but vendor/contracts/_pin.json was not updated. You must run 'pnpm vendor:contracts' and commit the vendored files."
    fi
    log_success "Vendored Contracts Consistency Passed."
else
    log_info "scripts/vendor-contracts.mjs was not modified."
fi

# 3. Update-Mechanik Drift-Regel
log_info "3. Checking Update-Mechanik Drift-Regel..."
UPDATE_MECHANIC_FILES="scripts/leitstand-up|deploy/docker-compose"
if echo "$MODIFIED_FILES" | grep -E -q "$UPDATE_MECHANIC_FILES"; then
    log_info "Update mechanics modified."
    if ! echo "$MODIFIED_FILES" | grep -q "docs/runbooks/ops.runbook.leitstand-gateway.updates.md"; then
        fail "Update mechanics were modified, but docs/runbooks/ops.runbook.leitstand-gateway.updates.md was not touched. Drift Rule violation! Please touch/update the runbook in the same PR."
    fi
    log_success "Update-Mechanik Drift-Regel Passed."
else
    log_info "Update mechanics not modified."
fi

log_success "All Drift Gates Passed!"