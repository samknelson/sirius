#!/usr/bin/env bash
# Push the workspace's main branch to a deployment branch on GitHub.
# Usage: scripts/dev/push-branch.sh <bao-dev|bao-stg|bao-prd>
# Also refreshes the bao-replit-main mirror branch.
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
HEAD_SHA=$(git rev-parse main)
echo "Pushing main ($HEAD_SHA) -> origin/$TARGET and origin/bao-replit-main"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "NOTE: working tree has uncommitted changes; they are NOT included (only committed work on main is pushed)."
fi

git push "$REMOTE" "main:refs/heads/$TARGET" "main:refs/heads/bao-replit-main"

echo "Done. $TARGET and bao-replit-main are now at $HEAD_SHA."
echo "This window will stay open so you can read the output; close/stop it when done."
# Keep output visible; workflow consoles close fast otherwise.
sleep 5
