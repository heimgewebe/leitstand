#!/usr/bin/env bash
set -euo pipefail

echo "Running Docs Relations Guard..."

# Ensure we have some form of relationship structure (e.g. frontmatter ID exists)
# Find all markdown files in docs/ excluding index.md and _generated
DOCS_TO_CHECK=$(find docs -name "*.md" | grep -v "index.md" | grep -v "_generated")

for doc in $DOCS_TO_CHECK; do
  if ! grep -q "^---$" "$doc"; then
    echo "❌ Missing frontmatter block in $doc"
    exit 1
  fi

  if ! grep -q "^id:" "$doc"; then
    echo "❌ Missing 'id' in frontmatter of $doc"
    exit 1
  fi
  if ! grep -q "^title:" "$doc"; then
    echo "❌ Missing 'title' in frontmatter of $doc"
    exit 1
  fi
  if ! grep -q "^doc_type:" "$doc"; then
    echo "❌ Missing 'doc_type' in frontmatter of $doc"
    exit 1
  fi
  if ! grep -q "^status:" "$doc"; then
    echo "❌ Missing 'status' in frontmatter of $doc"
    exit 1
  fi
  if ! grep -q "^canonicality:" "$doc"; then
    echo "❌ Missing 'canonicality' in frontmatter of $doc"
    exit 1
  fi
  if ! grep -q "^summary:" "$doc"; then
    echo "❌ Missing 'summary' in frontmatter of $doc"
    exit 1
  fi
done

echo "✅ Docs Relations Guard passed."
