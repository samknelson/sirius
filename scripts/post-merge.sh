#!/bin/bash
# Post-merge setup: install deps and sync the database schema with Drizzle.
#
# Idempotent and non-interactive. Stdin is closed by the runner, so any tool
# that reads from a TTY must be wrapped with the helper script that writes
# Enter keys at the prompt.
set -e

echo "[post-merge] Installing npm dependencies"
npm install --no-audit --no-fund

echo "[post-merge] Syncing schema via drizzle-kit push --force"
node scripts/post-merge-db-push.cjs

echo "[post-merge] Done"
