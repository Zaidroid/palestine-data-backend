#!/bin/bash

# Cleanup Obsolete Files Script
# Removes old hardcoded data files that are no longer used

echo "🧹 Palestine Pulse - Cleanup Obsolete Files"
echo "=========================================="
echo ""

# Check if we're in the right directory
if [ ! -d "src/data" ]; then
  echo "❌ Error: Must run from project root directory"
  exit 1
fi

echo "📋 Files to be deleted:"
echo ""
echo "  src/data/btselem-checkpoints.json"
echo "  src/data/demolitions-pre.json"
echo "  src/data/killedbyciv-pre.json"
echo "  src/data/maindata-pre.json"
echo "  src/data/minors-pre.json"
echo "  src/data/psbyps-pre.json"
echo "  src/data/spi-pre.json"
echo "  src/data/womein-pre.json"
echo ""

# Ask for confirmation
read -p "⚠️  Are you sure you want to delete these files? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Cancelled"
  exit 0
fi

echo ""
echo "🗑️  Deleting obsolete files..."
echo ""

# Delete files
deleted=0
failed=0

files=(
  "src/data/btselem-checkpoints.json"
  "src/data/demolitions-pre.json"
  "src/data/killedbyciv-pre.json"
  "src/data/maindata-pre.json"
  "src/data/minors-pre.json"
  "src/data/psbyps-pre.json"
  "src/data/spi-pre.json"
  "src/data/womein-pre.json"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    rm "$file"
    if [ $? -eq 0 ]; then
      echo "  ✓ Deleted: $file"
      ((deleted++))
    else
      echo "  ✗ Failed: $file"
      ((failed++))
    fi
  else
    echo "  ⊘ Not found: $file"
  fi
done

echo ""
echo "=========================================="
echo "✅ Cleanup complete!"
echo "   Deleted: $deleted files"
if [ $failed -gt 0 ]; then
  echo "   Failed: $failed files"
fi
echo ""
echo "📝 Next steps:"
echo "   1. Run: npm run build"
echo "   2. Test: npm run dev"
echo "   3. Commit: git add -A && git commit -m 'Remove obsolete data files'"
echo ""
