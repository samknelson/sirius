---
name: storage↔plugins circular import kills prod bundle
description: esbuild ESM bundle boot crash "Class extends value undefined" from storage importing plugin barrels
---
Rule: never statically import a plugin barrel (`server/plugins/*/index.ts`) from `server/storage/**`. The barrels eagerly load plugins that import back into storage; in the esbuild split-chunk ESM production bundle the cycle leaves a storage base class undefined at module init and the deploy crash-loops ("Class extends value undefined is not a constructor or null"). tsx dev mode tolerates the same cycle, so it only shows up after publish.

**Why:** prod deploy crash-looped at boot while dev was fine; trace ended in storage/wizards importing the wizard plugin barrel.

**How to apply:** if storage needs registry data, lazily `await import("../plugins/<kind>/registry")` inside an async callback, or import a cycle-safe submodule (type-only imports and `_core/kinds` are fine). Smoke test bundles with `node dist/production-entry.js` + bogus DATABASE_URL: getting past plugin registration to a DB connect error proves module init is clean.
