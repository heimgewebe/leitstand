#!/usr/bin/env bash
set -euo pipefail

# --- Configuration ---

if ! command -v git >/dev/null 2>&1; then
    echo "❌ Error: git is not installed or not in PATH." >&2
    exit 1
fi

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

# 4. Drift Prevention: Ensure deprecated script is NOT referenced
# We search for "leitstand-deploy" but exclude this script itself from the check.

DEPRECATED_TERM="leitstand-deploy"
THIS_SCRIPT_NAME="check-runbook-invariants.sh"

GREP_EXCLUDES=(
    "--exclude-dir=.git"
    "--exclude-dir=node_modules"
    "--exclude-dir=dist"
    "--exclude-dir=coverage"
    "--exclude-dir=.venv"
    "--exclude-dir=tmp"
    "--exclude=$THIS_SCRIPT_NAME"
)

if grep -R -F "$DEPRECATED_TERM" "$REPO_ROOT" "${GREP_EXCLUDES[@]}" >/dev/null 2>&1; then
    FOUND=$(grep -R -F "$DEPRECATED_TERM" "$REPO_ROOT" "${GREP_EXCLUDES[@]}" -l || true)

    if [[ -n "$FOUND" ]]; then
        echo -e "❌ Found references to deprecated '$DEPRECATED_TERM' in repository:\n$FOUND" >&2
        fail "Please remove these references and use 'scripts/leitstand-up' instead."
    fi
fi
log_success "No deprecated '$DEPRECATED_TERM' references found."

# 5. Reference Copy Integrity
# If docs/deploy/heimserver.naming.md exists, it must contain a valid provenance marker.
NAMING_REF="docs/deploy/heimserver.naming.md"
if [[ -f "$REPO_ROOT/$NAMING_REF" ]]; then
    # Check for existence of the field
    if ! grep -q "Upstream-Commit:" "$REPO_ROOT/$NAMING_REF"; then
        fail "Reference copy '$NAMING_REF' must contain 'Upstream-Commit:' field to ensure traceability."
    fi

    # Check for UNKNOWN value (strict mode)
    if grep -q "Upstream-Commit: UNKNOWN" "$REPO_ROOT/$NAMING_REF"; then
        fail "Reference copy '$NAMING_REF' has 'Upstream-Commit: UNKNOWN'. Please provide a valid commit hash or placeholder."
    fi

    log_success "Reference copy '$NAMING_REF' contains valid provenance marker."
fi

log_info "All invariants passed."
