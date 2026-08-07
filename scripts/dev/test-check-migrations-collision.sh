#!/usr/bin/env bash
# Regression tests for the core-migration version-collision guard in
# scripts/check-migrations.ts (the 1117/1120 silent-skip incident).
#
# Builds a throwaway git repo with divergent branches and asserts the check
# fails/passes correctly, including the case where the TARGET branch holds a
# higher version than the feature branch's tree.
#
# Usage: bash scripts/dev/test-check-migrations-collision.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/scripts/check-migrations.ts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

run_check() { # args: expected_exit label extra-args...
  local expected="$1" label="$2"; shift 2
  local actual=0
  (cd "$TMP" && npx tsx "$CHECK" "$@" >/dev/null 2>&1) || actual=$?
  if [ "$actual" -eq "$expected" ]; then
    echo "PASS: $label"
    PASS=$((PASS+1))
  else
    echo "FAIL: $label (expected exit $expected, got $actual)"
    FAIL=$((FAIL+1))
  fi
}

mig() { # args: path version
  mkdir -p "$(dirname "$TMP/$1")"
  printf 'export const version = %s;\n' "$2" > "$TMP/$1"
}

cd "$TMP"
git init -q -b main
git config user.email test@example.com
git config user.name test

# Base: main has core migrations 1119 and 1120.
mig scripts/migrate/core/1119_base.ts 1119
mig scripts/migrate/core/1120_base.ts 1120
git add -A && git commit -qm base

# Feature branch created from here.
git branch feature

# Target branch advances: main gains 1121 AFTER the feature branch diverged.
mig scripts/migrate/core/1121_target_only.ts 1121
git add -A && git commit -qm "main adds 1121"

git checkout -q feature

# 1) Divergent-branch collision: feature adds 1121 — equal to a TARGET-only
#    version the feature tree doesn't contain. Must FAIL against --base=main.
mig scripts/migrate/core/1121_feature.ts 1121
git add -A
run_check 1 "target-only higher version collides (1121 vs main's 1121)" --base=main
git rm -qf scripts/migrate/core/1121_feature.ts

# 2) Below-current-tree collision: untracked new file numbered <= local max.
mig scripts/migrate/core/1117_low.ts 1117
run_check 1 "new version below current-tree max fails (no base)"
run_check 1 "new version below current-tree max fails (--base=main)" --base=main
run_check 1 "--skip does not bypass the collision guard" --skip
rm scripts/migrate/core/1117_low.ts

# 3) Duplicate versions among new files.
mig scripts/migrate/core/1122_a.ts 1122
mig scripts/migrate/core/1122_b.ts 1122
run_check 1 "duplicate versions among new files fail" --base=main
rm -f scripts/migrate/core/1122_a.ts scripts/migrate/core/1122_b.ts

# 4) Correctly numbered new migration: above both trees' max (1121) → passes.
mig scripts/migrate/core/1122_ok.ts 1122
run_check 0 "version above both branches' max passes" --base=main
rm scripts/migrate/core/1122_ok.ts

# 5) No new migrations at all → passes.
git checkout -q -- . 2>/dev/null || true
run_check 0 "clean tree passes" --base=main

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
