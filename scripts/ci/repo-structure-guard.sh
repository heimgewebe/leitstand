#!/usr/bin/env bash
set -euo pipefail

echo "Running Repo Structure Guard..."

REQUIRED_FILES=(
  "README.md"
  "AGENTS.md"
  "repo.meta.yaml"
  "docs/index.md"
)

REQUIRED_DIRS=(
  "docs/_generated"
)

for file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "❌ Missing required file: $file"
    exit 1
  fi
done

for dir in "${REQUIRED_DIRS[@]}"; do
  if [ ! -d "$dir" ]; then
    echo "❌ Missing required directory: $dir"
    exit 1
  fi
done

if ! grep -q "repo_name:" repo.meta.yaml; then
  echo "❌ repo.meta.yaml is not parseable or missing repo_name."
  exit 1
fi

echo "✅ Repo Structure Guard passed."
