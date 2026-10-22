#!/bin/sh
# Enforce FORK-WORKFLOW.md Section 3, role-aware:
#   CORE  (foxtheme-base) → feature branch must only ADD .liquid/.js/.scss; no
#         modifications to existing files, so each feature stays cleanly
#         optional for child forks to merge.
#   CHILD (any fork)      → the child IS the design layer; editing visual
#         .liquid + .scss is the job. Only contract/infra files must stay
#         additive (they sync down from core): src/js/modules, src/js/library,
#         src/js/global (except custom.js, the child's own merge=ours file),
#         src/scss/mixins.
# Exceptions either way: locales/*.json (additive at key level), other types.
#
# A branch developed IN a child fork but destined for CORE (the common case for
# `/fix-core` and for a new component a fork contributes upstream) is branched
# off `upstream/main`, not `origin/main`. Role is therefore decided by where the
# branch actually GREW, not by which remotes the checkout happens to have.
# Override explicitly when the detection can't know your intent:
#   CHECK_ROLE=core ./scripts/check-additive-feature.sh
#
# Runs in CI on branches matching `feat/**`. To reproduce locally:
#   git checkout feat/your-branch
#   ./scripts/check-additive-feature.sh
#
# Exit codes:
#   0 — additive only, or no relevant file changes
#   1 — feature branch modified/deleted/renamed a guarded existing file
#   2 — could not determine base branch

set -e

# Make sure main is available for comparison. In Bitbucket Pipelines the
# default checkout doesn't fetch other branches.
if ! git rev-parse --verify origin/main >/dev/null 2>&1; then
  if ! git fetch origin main:refs/remotes/origin/main 2>/dev/null; then
    echo "Error: cannot fetch origin/main for comparison."
    exit 2
  fi
fi

HAS_UPSTREAM=0
if git remote | grep -qx upstream 2>/dev/null; then
  git fetch upstream main:refs/remotes/upstream/main 2>/dev/null || true
  git rev-parse --verify upstream/main >/dev/null 2>&1 && HAS_UPSTREAM=1
fi

# Detect repo role (see header). In CI, $BITBUCKET_REPO_SLUG names the repo.
# Locally, an `upstream` remote means we're in a child fork — but that alone
# does NOT mean this BRANCH is a child branch, so we test the branch itself.
ROLE="core"
BASE="origin/main"
if [ -n "$BITBUCKET_REPO_SLUG" ]; then
  case "$BITBUCKET_REPO_SLUG" in
    foxtheme-base) ROLE="core" ;;
    *)             ROLE="child" ;;
  esac
elif [ "$HAS_UPSTREAM" = "1" ]; then
  # In a child fork. Decide from WHERE THE BRANCH FORKED, by comparing its two
  # merge-bases. Do NOT use "is origin/main an ancestor of HEAD" — that is false
  # for any child branch that simply hasn't been rebased since origin/main moved,
  # which would misread a stale child branch as core-destined and fail it loudly.
  #
  #   child branch  → forked off fork history, so MB_origin is a DESCENDANT of
  #                   MB_upstream (the last core commit in that ancestry).
  #   core branch   → forked off upstream/main, so MB_upstream is AHEAD of
  #                   MB_origin (the fork's last sync point).
  MB_O=$(git merge-base origin/main HEAD 2>/dev/null || echo "")
  MB_U=$(git merge-base upstream/main HEAD 2>/dev/null || echo "")
  if [ -z "$MB_O" ] || [ -z "$MB_U" ] || [ "$MB_O" = "$MB_U" ]; then
    # Equal = the fork is fully synced at the fork point, so the two histories
    # are literally identical there and intent is unknowable. Default to the
    # lenient child rule and say so; pass CHECK_ROLE=core if it's core-destined.
    ROLE="child"
    [ "$MB_O" = "$MB_U" ] && AMBIGUOUS=1
  elif git merge-base --is-ancestor "$MB_U" "$MB_O" 2>/dev/null; then
    ROLE="child"
  else
    ROLE="core"
    BASE="upstream/main"
  fi
fi

# Explicit override always wins — detection cannot read intent, and a stale
# child branch (behind origin/main) would otherwise be misread as core-destined.
case "$CHECK_ROLE" in
  core)  ROLE="core";  [ "$HAS_UPSTREAM" = "1" ] && BASE="upstream/main" ;;
  child) ROLE="child"; BASE="origin/main" ;;
esac

# Diff range: commits unique to current branch since divergence from its base.
RANGE="$BASE...HEAD"

# ALWAYS say what was compared. A silent "✓ pass" that diffed the wrong base is
# indistinguishable from a real pass — which is exactly how this check once
# reported success four times on a branch it was not looking at.
echo "check-additive-feature: role=$ROLE base=$BASE branch=$(git rev-parse --abbrev-ref HEAD)"
if [ "$AMBIGUOUS" = "1" ] && [ -z "$CHECK_ROLE" ]; then
  echo "  note: fork is in sync at this branch point, so core-vs-child intent is"
  echo "  indistinguishable from history. Assuming child. If this branch is headed"
  echo "  for core, re-run with CHECK_ROLE=core to get the strict additive rule."
fi

# Status letters: A=added, M=modified, D=deleted, R=renamed, C=copied
# We FAIL on anything except A (and R, since rename also touches layout).
if [ "$ROLE" = "child" ]; then
  # Child: only contract/infra modifications are violations. Visual .liquid +
  # .scss partials may be edited freely — that's the design job, and sync keeps
  # the child's version (.gitattributes / fork-sync-resolver).
  # EXEMPT: `src/js/global/custom.js` is the child's own extension point
  # (`merge=ours` in .gitattributes) — editing it is the whole point. Its
  # siblings `modules.js` / `theme.js` are core-owned and sync down, so they
  # ARE guarded: modules.js is the `@theme/modules` bundle everything imports
  # from, which makes a child edit there the highest-conflict change of all.
  # These directories are where CORE ships its contract files, but a child also
  # writes its OWN modules there — a section's driver has nowhere else to live, and
  # `@theme/*` resolves only from `src/js/modules`. Matching by PATH alone called
  # those child-authored files core-owned, so the second round of edits to one was
  # blocked: after a feature first merges to `main`, the file exists on the base and
  # every later commit reads as `M` instead of `A`. Nothing about that can conflict
  # at `core:sync` — core has no such file to bring down.
  #
  # So ask core, not the path. `git cat-file -e upstream/main:<path>` is the whole
  # test: present in core → guarded, absent → the fork's own file, edit freely.
  # Without an `upstream` remote there is nobody to ask, and the path rule stands.
  CANDIDATES=$(git diff --name-status "$RANGE" \
    | awk '$1 != "A"' \
    | grep -E '(src/js/modules/|src/js/library/|src/js/global/|src/scss/mixins/)' \
    | grep -vE 'src/js/global/custom\.js$' \
    | grep -E '\.(js|scss)$' \
    || true)

  if [ "$HAS_UPSTREAM" = "1" ] && [ -n "$CANDIDATES" ]; then
    VIOLATIONS=$(printf '%s\n' "$CANDIDATES" | while IFS= read -r line; do
      [ -n "$line" ] || continue
      path=$(printf '%s' "$line" | cut -f2-)
      if git cat-file -e "upstream/main:$path" 2>/dev/null; then
        printf '%s\n' "$line"
      fi
    done)
  else
    VIOLATIONS="$CANDIDATES"
  fi
else
  # Core: strict additive for .liquid/.js/.scss.
  # EXEMPT: the SCSS registration indexes `_blocks.scss` / `_sections.scss` are
  # append-only manifests — registering a new partial means adding one `@use`
  # line, additive in spirit (like adding a key to locales/*.json). They may
  # produce a trivial append-conflict at `core:sync`, resolved like locales.
  # EXEMPT: `scripts/` is build/CI tooling, not theme source — the additive rule
  # exists so each THEME feature stays cleanly optional for child forks to
  # merge, which tooling never is. Matching by extension alone had already made
  # the guard inconsistent there (scripts/*.mjs passed, scripts/*.js failed).
  VIOLATIONS=$(git diff --name-status "$RANGE" \
    | awk '$1 != "A"' \
    | grep -E '\.(liquid|js|scss)$' \
    | grep -vE 'src/scss/global/_(blocks|sections)\.scss$' \
    | grep -vE '(^|[[:space:]])scripts/' \
    || true)
fi

if [ -z "$VIOLATIONS" ]; then
  if [ "$ROLE" = "child" ]; then
    echo "✓ Feature branch touches no contract/infra files (src/js/modules, src/js/library, src/js/global except custom.js, src/scss/mixins)."
  else
    echo "✓ Feature branch is additive-only (no modifications to existing .liquid/.js/.scss)."
  fi
  exit 0
fi

if [ "$ROLE" = "child" ]; then
  echo "✗ Feature branch modified core CONTRACT/INFRA files. A child fork may"
  echo "  re-skin visual .liquid/.scss freely, but these sync down from core and"
  echo "  must not be edited (extend via src/js/custom/ or src/scss/modules/):"
  echo ""
  echo "$VIOLATIONS" | sed 's/^/  /'
  echo ""
  echo "See FORK-WORKFLOW.md §5 (Tuyệt đối không được sửa) + §10."
  exit 1
fi

echo "✗ Feature branch modified existing core files. Per FORK-WORKFLOW.md §3,"
echo "  feature branches must only ADD new .liquid/.js/.scss files."
echo ""
echo "Violating changes (status: M=modified, D=deleted, R=renamed):"
echo ""
echo "$VIOLATIONS" | sed 's/^/  /'
echo ""
echo "If you need to extend a core component, add the extension point to"
echo "core/main first (regular commit on main, not in this feature branch),"
echo "then have your feature branch only listen. See FORK-WORKFLOW.md §3."
exit 1
