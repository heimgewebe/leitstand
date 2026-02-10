#!/usr/bin/env bash
set -euo pipefail

# --- Configuration ---
# Resolve repo root robustly to handle calls from anywhere
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Adjust paths relative to repo root
SCRIPT_PATH="scripts/leitstand-up"
RUNBOOK_GATEWAY="docs/runbooks/ops.runbook.leitstand-gateway.md"
RUNBOOK_MAIN="docs/runbooks/leitstand.md"

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
REQUIRED_STRINGS=(
    "./scripts/leitstand-up"
    "LEITSTAND_BIND_IP"
)

# Function to check a runbook
check_runbook() {
    local rb="$1"
    if [[ ! -f "$REPO_ROOT/$rb" ]]; then
        fail "Runbook '$rb' is missing!"
    fi
    for str in "${REQUIRED_STRINGS[@]}"; do
        if ! grep -F -e "$str" "$REPO_ROOT/$rb" >/dev/null; then
            fail "Runbook '$rb' is missing required reference: '$str'. Ensure the canonical deployment method is documented."
        fi
    done
    log_success "Runbook '$rb' contains required operative references."
}

check_runbook "$RUNBOOK_GATEWAY"
check_runbook "$RUNBOOK_MAIN"

log_info "All invariants passed."
