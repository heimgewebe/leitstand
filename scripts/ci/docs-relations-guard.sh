#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

echo "Checking document relations and frontmatter..." >&2

missing=0

# Use null-safe loop to find all markdown files in docs/ (excluding docs/_generated/)
while IFS= read -r -d '' file; do

  # Ensure the first line is exactly ---
  first_line=$(head -n 1 "$file" | tr -d '\r')
  if [ "$first_line" != "---" ]; then
    echo "ERROR: File '$file' does not start with frontmatter (---)." >&2
    missing=1
    continue
  fi

  # Extract frontmatter block roughly by taking lines between the first two "---"
  # and store it in a variable for easier checking
  frontmatter=$(awk '/^---$/{c++} c==1{print} c==2{print; exit}' "$file")

  # Define required fields
  required_fields=("id:" "title:" "doc_type:" "status:" "canonicality:" "summary:")

  for field in "${required_fields[@]}"; do
    if ! echo "$frontmatter" | grep -Eq "^${field}"; then
      echo "ERROR: File '$file' is missing required frontmatter field: ${field%:}" >&2
      missing=1
    fi
  done

  # Check canonical references
  canonicality=$(echo "$frontmatter" | grep -E "^canonicality:" | awk '{print $2}' | tr -d '\r')
  filename=$(basename "$file")

  if [ "$canonicality" = "canonical" ]; then
    # Must be referenced (if not index.md)
    if [ "$filename" != "index.md" ]; then
      # Find if any other .md file (excluding _generated) links to this file's basename
      if ! grep -qF "$filename" $(find docs/ -type f -name "*.md" -not -path "docs/_generated/*"); then
         echo "ERROR: File '$file' is canonical but not referenced by any other document." >&2
         missing=1
      fi
    fi
  elif [ "$canonicality" = "derived" ]; then
    # Must have a 'source' in frontmatter
    if ! echo "$frontmatter" | grep -Eq "^source:"; then
      echo "ERROR: File '$file' is derived but missing 'source:' in frontmatter." >&2
      missing=1
    fi
  fi

done < <(find docs/ -type f -name "*.md" -not -path "docs/_generated/*" -print0)

if [ "$missing" -eq 1 ]; then
  return 1 2>/dev/null || exit 1
fi

echo "docs-relations-guard: OK" >&2
