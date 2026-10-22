#!/bin/sh
set -e

echo "Commit => $BITBUCKET_COMMIT_MESSAGE"

# Bỏ qua nếu là release commit để tránh vòng lặp vô tận
if echo "$BITBUCKET_COMMIT_MESSAGE" | grep -qE "^chore\(release\):"; then
  echo "Release commit detected, skipping."
  exit 0
fi

# Cài git-cliff
curl -sSfL https://github.com/orhun/git-cliff/releases/download/v2.4.0/git-cliff-2.4.0-x86_64-unknown-linux-gnu.tar.gz \
  | tar -xz -C /tmp/
find /tmp -name "git-cliff" -type f | head -1 | xargs -I{} mv {} /usr/local/bin/git-cliff
chmod +x /usr/local/bin/git-cliff

# Config git
git config user.name "Pham Van Dung"
git config user.email "dungpham93@insights.is"

# Fetch toàn bộ history + tags.
# git-cliff rewrites the WHOLE changelog from the history it can see, so a
# shallow clone silently drops every older release (v2.13.3 shipped a
# CHANGELOG cut back to 2.2.1 when the unshallow failed under `|| true`).
# Unshallow or stop.
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  git fetch --unshallow
fi
git fetch --tags

# Build the release on the LATEST main — other merges may have landed after
# this pipeline was triggered (else the push below is non-fast-forward).
git fetch origin main --tags
git checkout -B main origin/main

# Detect version tiếp theo
NEXT_VERSION=$(git-cliff --config cliff.toml --bumped-version)
echo "Next version => $NEXT_VERSION"

# Kiểm tra tag chưa tồn tại
if git rev-parse "$NEXT_VERSION" > /dev/null 2>&1; then
  echo "Tag $NEXT_VERSION already exists, skipping."
  exit 0
fi

# Generate CHANGELOG + commit + tag + push
OLD_LINES=$(wc -l < CHANGELOG.md)
git-cliff --config cliff.toml --tag "$NEXT_VERSION" --output CHANGELOG.md
NEW_LINES=$(wc -l < CHANGELOG.md)
# A release only ever adds entries; a shorter file means history went missing.
if [ "$NEW_LINES" -lt "$OLD_LINES" ]; then
  echo "CHANGELOG.md shrank ($OLD_LINES -> $NEW_LINES lines), refusing to release."
  exit 1
fi
git add CHANGELOG.md
git commit -m "chore(release): $NEXT_VERSION"
git tag -a "$NEXT_VERSION" -m "$NEXT_VERSION"

# Push the release commit; survive concurrent merges (another PR may have
# merged after we started, advancing main).
while ! git push origin main; do
  git fetch origin main --tags
  # A concurrent pipeline may have already cut this version — bow out cleanly.
  if git rev-parse "$NEXT_VERSION" > /dev/null 2>&1; then
    echo "$NEXT_VERSION already released by a concurrent pipeline, skipping."
    exit 0
  fi
  echo "main advanced; rebasing release commit and retrying..."
  git rebase origin/main
done
git push origin "$NEXT_VERSION"

echo "Done! Released $NEXT_VERSION"
