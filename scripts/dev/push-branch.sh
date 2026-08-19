#!/usr/bin/env bash
# Push the workspace's main branch to a deployment branch on GitHub.
# Usage: scripts/dev/push-branch.sh <bao-dev|bao-stg|bao-prd>
# Also refreshes the bao-replit-main mirror branch.
# If a task agent pushed an equivalent pre-merge commit directly to either
# remote branch, safely reconciles that history before pushing.
# Requires GITHUB_TOKEN (a GitHub PAT with repo push access) as a Replit Secret.
set -euo pipefail

TARGET="${1:?usage: push-branch.sh <bao-dev|bao-stg|bao-prd>}"
case "$TARGET" in
  bao-dev|bao-stg|bao-prd) ;;
  *) echo "ERROR: target must be bao-dev, bao-stg, or bao-prd (got '$TARGET')"; exit 1 ;;
esac

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "ERROR: GITHUB_TOKEN secret is not set (needs a GitHub PAT with push access to samknelson/sirius)"
  exit 1
fi

REMOTE="https://x-access-token:${GITHUB_TOKEN}@github.com/samknelson/sirius.git"
MIRROR="bao-replit-main"
TRACKING_NAMESPACE="refs/remotes/push-workflow"
TEMP_FILES=()

cleanup() {
  local path branch
  for path in "${TEMP_FILES[@]}"; do
    rm -f "$path"
  done
  for branch in "$TARGET" "$MIRROR"; do
    git update-ref -d "$TRACKING_NAMESPACE/$branch" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

fetch_branch() {
  local branch="$1"
  git fetch --no-tags "$REMOTE" \
    "+refs/heads/$branch:$TRACKING_NAMESPACE/$branch"
}

reconcile_equivalent_remote_history() {
  local branch="$1"
  local remote_ref="$TRACKING_NAMESPACE/$branch"
  local base patch_file index_file old_main main_tree reconciled_main

  if git merge-base --is-ancestor "$remote_ref" main; then
    return
  fi

  if ! base=$(git merge-base main "$remote_ref"); then
    echo "ERROR: origin/$branch has no common ancestor with main."
    echo "Refusing to overwrite unrelated remote history."
    exit 1
  fi

  patch_file=$(mktemp)
  index_file=$(mktemp)
  TEMP_FILES+=("$patch_file" "$index_file")
  rm -f "$index_file"

  # Compare only committed main, not the user's working tree or index. Reverse
  # application proves the remote branch's net changes are already in main.
  git diff --binary --full-index "$base" "$remote_ref" > "$patch_file"
  GIT_INDEX_FILE="$index_file" git read-tree main
  if [ -s "$patch_file" ] && \
     ! GIT_INDEX_FILE="$index_file" git apply --cached --check --reverse "$patch_file"; then
    echo "ERROR: origin/$branch contains remote-only changes that are not already in main."
    echo "Refusing to force-push or discard them. Manual review is required."
    echo
    echo "Remote-only commits:"
    git log --oneline "main..$remote_ref"
    echo
    echo "Remote branch changes since the common ancestor:"
    git diff --stat "$base" "$remote_ref"
    exit 1
  fi

  old_main=$(git rev-parse main)
  main_tree=$(git rev-parse 'main^{tree}')
  reconciled_main=$(
    printf 'Reconcile %s before deployment push\n\nRemote-only changes were verified as already present in main; keep the main tree unchanged.\n' \
      "origin/$branch" |
      git commit-tree "$main_tree" -p "$old_main" -p "$remote_ref"
  )
  git update-ref refs/heads/main "$reconciled_main" "$old_main"
  echo "Reconciled equivalent origin/$branch history without changing the main tree."
}

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "NOTE: working tree has uncommitted changes; they are NOT included (only committed work on main is pushed)."
fi

echo "Fetching origin/$TARGET and origin/$MIRROR..."
fetch_branch "$TARGET"
fetch_branch "$MIRROR"

reconcile_equivalent_remote_history "$TARGET"
reconcile_equivalent_remote_history "$MIRROR"

HEAD_SHA=$(git rev-parse main)
echo "Pushing main ($HEAD_SHA) -> origin/$TARGET and origin/$MIRROR"

# GitHub supports atomic pushes. This prevents the target from updating while
# the mirror fails (or vice versa), which otherwise leaves them out of sync.
git push --atomic "$REMOTE" \
  "main:refs/heads/$TARGET" \
  "main:refs/heads/$MIRROR"

echo "Done. $TARGET and $MIRROR are now at $HEAD_SHA."
echo "This window will stay open so you can read the output; close/stop it when done."
# Keep output visible; workflow consoles close fast otherwise.
sleep 5
