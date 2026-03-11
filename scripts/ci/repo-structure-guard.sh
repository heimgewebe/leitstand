#!/usr/bin/env bash
set -euo pipefail

echo "Checking required repository artifacts..."

REQUIRED_FILES=(
  "README.md"
  "AGENTS.md"
  "repo.meta.yaml"
  "docs/index.md"
  "docs/_generated/doc-index.md"
)

missing=0
for file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "ERROR: Missing required artifact: $file"
    missing=1
  fi
done

if [ "$missing" -eq 1 ]; then
  return 1 2>/dev/null || exit 1
fi

echo "repo-structure-guard: OK"
