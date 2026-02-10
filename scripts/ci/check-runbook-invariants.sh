#!/usr/bin/env bash
set -euo pipefail

# --- Configuration ---
# Resolve repo root robustly to handle calls from anywhere
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Adjust paths relative to repo root
SCRIPT_PATH="scripts/leitstand-up"
RUNBOOK_PATH="docs/runbooks/ops.runbook.leitstand-gateway.md"

log_info() { echo "→ $1"; }
log_success() { echo "✓ $1"; }
log_error() { echo "❌ $1" >&2; }
fail() { log_error "$1"; exit 1; }

# --- Checks ---

log_info "Checking Operative Invariants..."

# 1. Deployment Script
if [[ ! -f "$REPO_ROOT/$SCRIPT_PATH" ]]; then
    fail "Deployment script '$SCRIPT_PATH' is missing!"
fi
if [[ ! -x "$REPO_ROOT/$SCRIPT_PATH" ]]; then
    fail "Deployment script '$SCRIPT_PATH' is not executable!"
fi
log_success "Deployment script exists and is executable."

# 2. Compose Files
COMPOSE_FILES=(
    "deploy/docker-compose.yml"
    "deploy/docker-compose.loopback.yml"
    "deploy/docker-compose.lan.yml"
    "deploy/docker-compose.proxy.yml"
)

for file in "${COMPOSE_FILES[@]}"; do
    if [[ ! -f "$REPO_ROOT/$file" ]]; then
        fail "Required Compose file '$file' is missing!"
    fi
done
log_success "All required Compose files exist."

# 3. Runbook Consistency
if [[ ! -f "$REPO_ROOT/$RUNBOOK_PATH" ]]; then
    fail "Runbook '$RUNBOOK_PATH' is missing!"
fi

REQUIRED_STRINGS=(
    "./scripts/leitstand-up"
    "--proxy"
    "LEITSTAND_BIND_IP"
)

for str in "${REQUIRED_STRINGS[@]}"; do
    # Use -F for fixed string and -e to prevent option parsing issues
    if ! grep -F -e "$str" "$REPO_ROOT/$RUNBOOK_PATH" >/dev/null; then
        fail "Runbook '$RUNBOOK_PATH' is missing required reference: '$str'. Ensure the canonical deployment method is documented."
    fi
done
log_success "Runbook contains required operative references."

log_info "All invariants passed."
