#!/bin/sh
# Register git merge drivers used by .gitattributes.
# Run once on each developer's machine after cloning.
#
# Idempotent — safe to re-run.

set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  echo "Error: not inside a git repository."
  exit 1
fi

echo "Setting up merge drivers for $REPO_ROOT"

# `ours` driver — git built-in, but needs explicit enable.
# Used by .gitattributes for per-project files (templates/*.json, etc.)
git config --global merge.ours.driver true
echo "  ✓ merge.ours.driver = true (global)"

# `foxlocale` driver — JSON-aware 3-way merge for Shopify locale files.
# Configured per-repo because the driver path is repo-specific.
DRIVER_PATH="$REPO_ROOT/scripts/merge-drivers/locale-merge.mjs"
if [ ! -f "$DRIVER_PATH" ]; then
  echo "Error: $DRIVER_PATH not found."
  exit 1
fi

git config merge.foxlocale.name "JSON-aware locale merge"
git config merge.foxlocale.driver "node $DRIVER_PATH %O %A %B"
echo "  ✓ merge.foxlocale.driver registered (repo-local)"

echo ""
echo "Done. Merge drivers active."
