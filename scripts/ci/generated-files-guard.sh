#!/usr/bin/env bash
set -euo pipefail

echo "Checking generated files..." >&2

GENERATED_FILES=(
  "docs/_generated/doc-index.md"
  "docs/_generated/system-map.md"
  "docs/_generated/orphans.md"
  "docs/_generated/impl-index.md"
  "docs/_generated/backlinks.md"
  "docs/_generated/supersession-map.md"
  "docs/_generated/agent-readiness.md"
)

missing=0
for file in "${GENERATED_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "ERROR: Missing generated file: $file" >&2
    missing=1
  else
    if ! grep -Fq "This is a generated file. Do not edit manually." "$file"; then
      echo "ERROR: Missing generated header in $file" >&2
      missing=1
    fi
  fi
done

if [ "$missing" -eq 1 ]; then
  return 1 2>/dev/null || exit 1
fi

echo "generated-files-guard: OK" >&2
