#!/usr/bin/env bash
set -euo pipefail

echo "Running Generated Files Guard..."

# Ensure generated files have the correct warning header
GENERATED_FILES=(
  "docs/_generated/doc-index.md"
  "docs/_generated/system-map.md"
  "docs/_generated/orphans.md"
)

for file in "${GENERATED_FILES[@]}"; do
  if [ -f "$file" ]; then
    if ! grep -qi "This is a generated file" "$file"; then
      echo "❌ Generated file $file is missing the 'This is a generated file' warning header."
      exit 1
    fi
  else
    # The blueprint requires these generated files to exist.
    echo "❌ Missing generated file: $file"
    exit 1
  fi
done

echo "✅ Generated Files Guard passed."
