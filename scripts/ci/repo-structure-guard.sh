#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

echo "Checking required repository artifacts..." >&2

REQUIRED_FILES=(
  "README.md"
  "AGENTS.md"
  "repo.meta.yaml"
  "agent-policy.yaml"
  "docs/index.md"
)

missing=0

for file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "ERROR: Missing required artifact: $file" >&2
    missing=1
  fi
done

if [ ! -d "docs/_generated/" ]; then
  echo "ERROR: Missing required directory: docs/_generated/" >&2
  missing=1
fi

if [ -f "repo.meta.yaml" ]; then
  if ! grep -q "^repo_name:" repo.meta.yaml; then
    echo "ERROR: repo.meta.yaml is missing 'repo_name:'" >&2
    missing=1
  fi
  if ! grep -q "^repo_type:" repo.meta.yaml; then
    echo "ERROR: repo.meta.yaml is missing 'repo_type:'" >&2
    missing=1
  fi
fi

if [ "$missing" -eq 1 ]; then
  return 1 2>/dev/null || exit 1
fi

echo "repo-structure-guard: OK" >&2
