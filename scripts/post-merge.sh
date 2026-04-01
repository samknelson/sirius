#!/bin/bash
set -e
npm install
timeout 15 npx drizzle-kit push --force 2>&1 || echo "drizzle-kit push completed or timed out (interactive prompts) - schema may need manual sync"
