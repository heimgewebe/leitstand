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
      outer_start = RSTART
      outer_length = RLENGTH
      link_full = substr($0, outer_start, outer_length)
      if (match(link_full, /\([^)]+\)/)) {
        link = substr(link_full, RSTART+1, RLENGTH-2)
        print link
      }
      $0 = substr($0, outer_start + outer_length)
    }
  }
' docs/index.md | while read -r link; do
    # Skip empty, external, or absolute links
    if [[ -z "$link" || "$link" == http* || "$link" == /* ]]; then
        continue
    fi
    # Skip links pointing outside the docs folder (e.g. scripts)
    if [[ "$link" == ../* ]]; then
        continue
    fi

    # Strip any anchors if present
    file_path="${link%%#*}"
    if [[ ! -f "docs/$file_path" ]]; then
        fail "docs/index.md contains a broken docs link: $link (resolved to docs/$file_path)"
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
    BASE="origin/$GITHUB_BASE_REF"
    MB="$(git merge-base HEAD "$BASE" 2>/dev/null || true)"
    if [[ -n "$MB" ]]; then
        log_info "Diffing PR range from merge-base: $MB..HEAD"
        MODIFIED_FILES=$(git diff --name-only "$MB..HEAD" || true)
    else
        log_info "Diffing PR against origin base: $BASE..HEAD"
        MODIFIED_FILES=$(git diff --name-only "$BASE" HEAD || true)
    fi
# 3. GH Actions: push
elif [[ -n "${GITHUB_SHA:-}" && "${GITHUB_EVENT_NAME:-}" == "push" ]]; then
    # Parse before SHA without jq, using grep/awk
    BEFORE_SHA=$(grep -o '"before": *"[^"]*"' "$GITHUB_EVENT_PATH" 2>/dev/null | awk -F'"' '{print $4}' || echo "0000000000000000000000000000000000000000")
    if [[ -z "$BEFORE_SHA" || "$BEFORE_SHA" == "0000000000000000000000000000000000000000" || "$BEFORE_SHA" == "null" ]]; then
        log_info "New branch or missing before SHA. Diffing latest commit only."
        MODIFIED_FILES=$(git show --name-only --pretty='' "$GITHUB_SHA" || true)
    else
        log_info "Diffing range: $BEFORE_SHA..$GITHUB_SHA"
        MODIFIED_FILES=$(git diff --name-only "$BEFORE_SHA..$GITHUB_SHA" || true)
    fi
fi

if [[ -z "$MODIFIED_FILES" ]]; then
    echo "⚠️ Warning: MODIFIED_FILES is empty. Drift Gates change-coupling checks might be skipped." >&2
else
    log_info "Modified files to check against gates:"
    echo "$MODIFIED_FILES"
fi

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
