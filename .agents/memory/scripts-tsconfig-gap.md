---
name: Migration scripts outside app tsconfig
description: App tsc green says nothing about scripts/; typecheck scripts with tsconfig.scripts.json BEFORE first execution of new loaders.
---

**Rule:** The app tsconfig (`npx tsc --noEmit`) does not cover `scripts/`. Treat any new or edited script there as unchecked until `npx tsc -p tsconfig.scripts.json --noEmit` passes (extend that config's `include` when new script trees appear).

**Why:** Type errors in scripts (wrong shared-lib return shapes, misnamed storage accessors) have shipped "tsc-green" and only surfaced at runtime — sometimes after writing garbage rows — because no tsconfig included them.

**How to apply:** Run the scripts typecheck before first execution of a loader; when consuming shared libs or the storage layer from scripts, verify shapes/names against the source, not memory. "Worked in dev" is weak evidence — dev data often skips the failing path.
