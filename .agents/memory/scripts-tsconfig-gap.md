---
name: Migration scripts outside app tsconfig
description: App tsc green says nothing about scripts/; typecheck scripts with tsconfig.scripts.json BEFORE first execution of new loaders.
---

**Rule:** `npx tsc --noEmit` (the app tsconfig) only covers `client/src`, `shared`, `server`. Everything under `scripts/` is invisible to it. After writing or touching migration loaders / oneoff scripts, run `npx tsc -p tsconfig.scripts.json --noEmit` (config includes `scripts/s1-migration/**` + the loader smoke test; extend its `include` when new script trees need coverage) BEFORE first execution.

**Why:** Two whole bug classes shipped "tsc-green" and only surfaced at runtime or via smoke tests:
- consumers of a shared lib's `getMappings()` treated `Map<number,{s2Id,stub}>` values as plain strings (garbage `entity_id` rows written to the DB before being caught);
- loaders called a nonexistent storage accessor (`storage.trustElections` — real name `workerTrustElections`), which threw only when the write path was finally exercised.
Both would have been compile errors under any tsconfig that included the scripts.

**How to apply:** treat a new/edited script under `scripts/` as unchecked until `tsc -p tsconfig.scripts.json` passes. When consuming shared libs or the storage layer from scripts, verify return shapes/accessor names against the source file, not memory. Runtime "worked in dev" is weak evidence — dev data often skips the code path entirely (e.g. rejects-all rows never reach the write pass).
