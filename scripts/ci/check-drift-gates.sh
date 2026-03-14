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

log_info "Skipping non-doc links (../, http(s), absolute) by design"
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
# Default to empty, populated conditionally
MODIFIED_FILES=""

if [[ "${GITHUB_ACTIONS:-}" == "true" || "${CI:-}" == "true" ]]; then
    # 1. GH Actions: pull_request
    if [[ "${GITHUB_EVENT_NAME:-}" == "pull_request" ]]; then
        # GitHub Actions checkouts for PRs are merge commits (refs/pull/X/merge)
        # diffing against HEAD^1 compares against the base branch commit
        log_info "Diffing PR merge commit against base (HEAD^1)"
        MODIFIED_FILES=$(git diff --name-only HEAD^1 HEAD 2>/dev/null || true)

        # Fallback to merge-base if HEAD^1 fails
        if [[ -z "$MODIFIED_FILES" && -n "${GITHUB_BASE_REF:-}" ]]; then
            BASE="origin/$GITHUB_BASE_REF"
            MB="$(git merge-base HEAD "$BASE" 2>/dev/null || true)"
            if [[ -n "$MB" ]]; then
                log_info "Fallback: Diffing PR range from merge-base: $MB..HEAD"
                MODIFIED_FILES=$(git diff --name-only "$MB..HEAD" || true)
            else
                log_info "Fallback: Diffing PR against origin base: $BASE..HEAD"
                MODIFIED_FILES=$(git diff --name-only "$BASE" HEAD || true)
            fi
        fi
    # 2. GH Actions: push
    elif [[ "${GITHUB_EVENT_NAME:-}" == "push" ]]; then
        # Parse before SHA without jq, using grep/awk
        BEFORE_SHA=$(grep -o '"before": *"[^"]*"' "$GITHUB_EVENT_PATH" 2>/dev/null | awk -F'"' '{print $4}' || echo "0000000000000000000000000000000000000000")
        if [[ -z "$BEFORE_SHA" || "$BEFORE_SHA" == "0000000000000000000000000000000000000000" || "$BEFORE_SHA" == "null" ]]; then
            log_info "New branch or missing before SHA. Diffing latest commit only."
            MODIFIED_FILES=$(git show --name-only --pretty='' "${GITHUB_SHA:-HEAD}" || true)
        else
            log_info "Diffing range: $BEFORE_SHA..${GITHUB_SHA:-HEAD}"
            MODIFIED_FILES=$(git diff --name-only "$BEFORE_SHA..${GITHUB_SHA:-HEAD}" || true)
        fi
    fi

    # Global Fallback in CI if still empty
    if [[ -z "$MODIFIED_FILES" ]]; then
        log_info "Fallback: using git show --name-only against HEAD"
        MODIFIED_FILES=$(git show --name-only --pretty='' HEAD || true)
    fi

    if [[ -z "$MODIFIED_FILES" ]]; then
        fail "MODIFIED_FILES is empty in CI; refusing to skip drift change-coupling gates. This indicates an invalid diff range or missing history."
    fi
else
    # 3. Local developer environment
    # Use uncommitted dirty files, or fallback to the latest commit if clean
    MODIFIED_FILES=$(git diff --name-only HEAD || git ls-files --modified)
    if [[ -z "$MODIFIED_FILES" ]]; then
        log_info "Clean working tree. Diffing against latest commit..."
        MODIFIED_FILES=$(git show --name-only --pretty='' HEAD || true)
    fi

    if [[ -z "$MODIFIED_FILES" ]]; then
        echo "⚠️ Warning: MODIFIED_FILES is empty locally. Drift Gates change-coupling checks might be skipped." >&2
    fi
fi

if [[ -n "$MODIFIED_FILES" ]]; then
    log_info "Modified files to check against gates:"
    echo "$MODIFIED_FILES"
fi

# 2. Implicit Dependencies (Drift Map)
log_info "2. Checking Implicit Dependencies from docs/drift.map.yaml..."

if [[ ! -f "docs/drift.map.yaml" ]]; then
    fail "docs/drift.map.yaml is missing."
fi

# Parse the rules and evaluate them
awk '
  /^[[:space:]]*- trigger:/ {
    trigger = $0
    sub(/^[[:space:]]*- trigger:[[:space:]]*"/, "", trigger)
    sub(/"[[:space:]]*$/, "", trigger)
    getline
    req = $0
    sub(/^[[:space:]]*require:[[:space:]]*"/, "", req)
    sub(/"[[:space:]]*$/, "", req)
    getline
    msg = $0
    sub(/^[[:space:]]*message:[[:space:]]*"/, "", msg)
    sub(/"[[:space:]]*$/, "", msg)
    print trigger "@@@" req "@@@" msg
  }
' docs/drift.map.yaml | while IFS= read -r line; do
    trigger="${line%%@@@*}"
    rest="${line#*@@@}"
    require="${rest%%@@@*}"
    msg="${rest#*@@@}"
    log_info "Checking Rule: $msg (trigger: $trigger)"
    if echo "$MODIFIED_FILES" | grep -E -q "$trigger"; then
        log_info "Trigger matched ($trigger)"
        if ! echo "$MODIFIED_FILES" | grep -F -q "$require"; then
            fail "Drift Rule Violation: $msg. Modified files matched trigger '$trigger', but required file '$require' was not modified."
        fi
        log_success "Rule '$msg' Passed."
    else
        log_info "Trigger not matched for rule: $msg"
    fi
done

log_success "All Drift Gates Passed!"
