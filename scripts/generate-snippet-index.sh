#!/bin/bash
# Generate snippet index from templates/snippets/

SNIPPETS_DIR="templates/snippets"
OUTPUT="templates/snippets/INDEX.md"

cat > "$OUTPUT" << 'HEADER'
# Snippet Index

> Auto-generated. Do not edit manually.
> Run `./scripts/generate-snippet-index.sh` to regenerate.

| Snippet | Purpose | Exports |
|---------|---------|---------|
HEADER

for file in "$SNIPPETS_DIR"/*.js; do
  [ -f "$file" ] || continue
  
  filename=$(basename "$file")
  
  # Extract first line of JSDoc comment for purpose
  purpose=$(grep -m1 '^\s*\*\s*[A-Z]' "$file" | sed 's/.*\* //' | head -c 50)
  
  # Extract module.exports
  exports=$(grep -oP 'module\.exports\s*=\s*\{[^}]+\}' "$file" | sed 's/module.exports = { //' | sed 's/ }//' | tr -d '\n' | head -c 60)
  
  if [ -z "$exports" ]; then
    exports=$(grep -oP 'module\.exports\s*=\s*\w+' "$file" | sed 's/module.exports = //')
  fi
  
  echo "| [$filename](./$filename) | $purpose | \`$exports\` |" >> "$OUTPUT"
done

echo "" >> "$OUTPUT"
echo "---" >> "$OUTPUT"
echo "" >> "$OUTPUT"
echo "## Quick Copy" >> "$OUTPUT"
echo "" >> "$OUTPUT"

for file in "$SNIPPETS_DIR"/*.js; do
  [ -f "$file" ] || continue
  filename=$(basename "$file" .js)
  
  echo "### $filename" >> "$OUTPUT"
  echo '```javascript' >> "$OUTPUT"
  echo "const { ... } = require('./snippets/$filename');" >> "$OUTPUT"
  echo '```' >> "$OUTPUT"
  echo "" >> "$OUTPUT"
done

echo "✓ Generated $OUTPUT"
