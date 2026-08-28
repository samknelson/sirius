#!/usr/bin/env bash
# Merge-flow guard for the core-migration version-counter collision
# (the 1117/1120 silent-skip incident).
#
# Runs scripts/check-migrations.ts against BOTH deployment branches
# (origin/bao-dev and origin/bao-prd), so a newly added core migration must
# be numbered above the max version on both. Because the two deployment
# branches merge into each other in both directions, checking against both
# refs is equivalent to checking against "the target branch" regardless of
# merge direction. origin/main is deliberately NOT checked: it is a stale
# pre-split trunk, and diffing against it reports long-deployed historical
# migrations as "new" (false positives).
#
# Registered as the `migrations` validation (runs on every task completion);
# also safe to run manually before any merge:
#
#   bash scripts/dev/check-migrations-merge.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# Best-effort refresh of remote refs; offline is fine (stale refs still guard).
git fetch origin --quiet 2>/dev/null || true

FAIL=0
for ref in origin/bao-dev origin/bao-prd; do
  if ! git rev-parse --verify --quiet "$ref" >/dev/null; then
    echo "[check-migrations-merge] skipping $ref (not present)"
    continue
  fi
  echo "[check-migrations-merge] checking against --base=$ref"
  # Task completion already enforces schema-change/migration pairing. At
  # post-merge time the deployment branches can legitimately contain different
  # subsets of migrations, so rerunning that pairing check against each branch
  # produces false failures for later type-only schema edits. --skip bypasses
  # only the pairing rule; checkCoreVersionCollisions deliberately still runs.
  if ! npx tsx scripts/check-migrations.ts --base="$ref" --skip; then
    echo "[check-migrations-merge] FAILED against $ref"
    FAIL=1
  fi
done

exit "$FAIL"
