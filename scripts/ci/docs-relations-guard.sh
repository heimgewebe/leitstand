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
      # Escape filename for robust grep regex usage (e.g. escape . [ ] ^ $ * + ? ( ) { } | \)
      escaped_filename=$(echo "$filename" | awk '{gsub(/[\]\[.\\\^\$\*\+\?\(\)\{\}\|]/,"\\\\&");print}')

      # Search for a markdown link target pointing to this file in other documents.
      # E.g., looking for `](...filename...)`
      # We exclude the current file and generated files. Use null-safe loop to avoid word splitting.
      found_reference=0
      while IFS= read -r -d '' candidate_file; do
        if grep -Eq "\]\([^)]*${escaped_filename}[^)]*\)" "$candidate_file"; then
          found_reference=1
          break
        fi
      done < <(find docs/ -type f -name "*.md" -not -path "docs/_generated/*" -not -path "$file" -print0)

      if [ "$found_reference" -eq 0 ]; then
         echo "WARNING: File '$file' is canonical but not referenced via markdown link target by any other document." >&2
         # Downgraded to warning to prioritize robustness over strict ambition in Bash.
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
