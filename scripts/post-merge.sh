#!/bin/bash
# Post-merge setup: install npm dependencies.
#
# Schema changes are NOT applied here. Per replit.md "All schema changes MUST
# ship with a migration", any schema drift is handled by the per-component
# migration framework that runs at server startup (see scripts/migrate/).
# Running `drizzle-kit push` here is forbidden and will be rejected by
# scripts/db-push.ts unless ALLOW_DB_PUSH=1 is set (which must never be set
# in automation).
#
# Idempotent and non-interactive. Stdin is closed by the runner.
set -euo pipefail

# Serialize dependency replacement across setup invocations.
mkdir -p .cache
exec 9>.cache/post-merge-install.lock
flock -w 120 9
install_log=$(mktemp)
trap 'rm -f "$install_log"' EXIT

echo "[post-merge] Checking runtime and installing locked npm dependencies"
test "$(node --version)" = "v$(cat .node-version)" || {
  echo "[post-merge] Wrong Node runtime; reload the Replit Nix environment" >&2
  exit 1
}
if npm ci --no-audit --no-fund >"$install_log" 2>&1; then
  cat "$install_log"
else
  status=$?
  cat "$install_log" >&2
  # A concurrent process can finish writing a generated file while npm removes
  # the old tree. Retry cleanup once, but never hide other installation errors.
  if grep -q 'ENOTEMPTY' "$install_log"; then
    echo "[post-merge] Retrying locked install after directory cleanup raced"
    npm ci --no-audit --no-fund
  else
    exit "$status"
  fi
fi

echo "[post-merge] Done"
