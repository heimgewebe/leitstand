#!/usr/bin/env bash
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
    echo "Error: git is not installed or not in PATH." >&2
    exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
RELEASE_SCRIPT="scripts/leitstand-release.py"
COMPOSE_SCRIPT="scripts/leitstand-up"
RUNBOOK_RELEASE="docs/runbooks/local-release-runtime.md"
RUNBOOK_GATEWAY="docs/runbooks/ops.runbook.leitstand-gateway.md"
RUNBOOK_MAIN="docs/runbooks/leitstand.md"

log_info() { echo "→ $1"; }
log_success() { echo "✓ $1"; }
fail() { echo "Error: $1" >&2; exit 1; }

log_info "Checking operative deployment invariants..."

for script in "$RELEASE_SCRIPT" "$COMPOSE_SCRIPT"; do
    [[ -f "$REPO_ROOT/$script" ]] || fail "Deployment entry point '$script' is missing."
    [[ -x "$REPO_ROOT/$script" ]] || fail "Deployment entry point '$script' is not executable."
done
log_success "Versioned runtime and optional Compose entry points exist and are executable."

REQUIRED_RELEASE_FILES=(
    "deploy/systemd/leitstand.service"
    "deploy/systemd/leitstand-storage-health.service"
    "deploy/systemd/runtime-config.example.json"
    "tests/test_release_runtime.py"
)
for file in "${REQUIRED_RELEASE_FILES[@]}"; do
    [[ -f "$REPO_ROOT/$file" ]] || fail "Required release-runtime file '$file' is missing."
done
log_success "Coupled user-systemd release files exist."

COMPOSE_FILES=(
    "deploy/docker-compose.yml"
    "deploy/docker-compose.loopback.yml"
    "deploy/docker-compose.lan.yml"
    "deploy/docker-compose.proxy.yml"
)
for file in "${COMPOSE_FILES[@]}"; do
    [[ -f "$REPO_ROOT/$file" ]] || fail "Optional Compose contract file '$file' is missing."
done
log_success "Optional Compose development files remain complete."

REQUIRED_STRINGS=(
    "scripts/leitstand-release.py"
    "leitstand-storage-health.service"
    "runtime-config.example.json"
)
check_runbook() {
    local runbook="$1"
    [[ -f "$REPO_ROOT/$runbook" ]] || fail "Runbook '$runbook' is missing."
    for value in "${REQUIRED_STRINGS[@]}"; do
        grep -F -e "$value" "$REPO_ROOT/$runbook" >/dev/null \
            || fail "Runbook '$runbook' is missing canonical release reference '$value'."
    done
    log_success "Runbook '$runbook' contains the canonical coupled-release contract."
}
check_runbook "$RUNBOOK_RELEASE"
check_runbook "$RUNBOOK_GATEWAY"
check_runbook "$RUNBOOK_MAIN"

if grep -R -F "leitstand-deploy" "$REPO_ROOT" \
    --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist \
    --exclude-dir=coverage --exclude-dir=.venv --exclude-dir=tmp \
    --exclude=check-runbook-invariants.sh >/dev/null 2>&1; then
    fail "Deprecated 'leitstand-deploy' references remain; use scripts/leitstand-release.py."
fi
log_success "No deprecated deployment entry point remains."

NAMING_REF="docs/deploy/heimserver.naming.md"
if [[ -f "$REPO_ROOT/$NAMING_REF" ]]; then
    grep -Eq "^[[:space:]]*Upstream-Commit:[[:space:]]*[0-9a-f]{40}[[:space:]]*$" \
        "$REPO_ROOT/$NAMING_REF" \
        || fail "Reference copy '$NAMING_REF' lacks a valid 40-hex Upstream-Commit."
    ! grep -q "Upstream-Commit: 0000000000000000000000000000000000000000" \
        "$REPO_ROOT/$NAMING_REF" \
        || fail "Reference copy '$NAMING_REF' uses a zero-hash placeholder."
    grep -Eq "^[[:space:]]*Upstream-Verified:[[:space:]]*true[[:space:]]*$" \
        "$REPO_ROOT/$NAMING_REF" \
        || fail "Reference copy '$NAMING_REF' must declare Upstream-Verified: true."
    log_success "Reference copy provenance is valid."
fi

log_info "All operative deployment invariants passed."
