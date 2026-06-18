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
set -e

echo "[post-merge] Installing npm dependencies"
npm install --no-audit --no-fund

echo "[post-merge] Done"
