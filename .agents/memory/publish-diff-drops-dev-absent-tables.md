---
name: Publish diff drops tables absent from dev
description: Replit Publish diffs the dev DB against prod and DROPS any prod table dev lacks — component-owned tables enabled only in prod get silently destroyed on every publish.
---

**Rule:** Any table that must exist in production (e.g. tables of an optional component enabled only in prod) must ALSO physically exist in the dev database, even if the owning component is disabled in dev. Otherwise every Publish drops it from prod.

**Why:** Replit's Publish flow applies `diff(dev DB schema, prod DB schema)` to prod. A boot-time self-heal migration only runs once (its version is recorded), so after the *next* publish drops the tables again, the migration cannot re-run and the startup drift gate crash-loops the deployment. This exact loop hit the bulk component: migration created tables → publish succeeded → next publish dropped them → crash loop.

**How to apply:**
- Keep prod-only component tables present (empty) in dev: create them from the component manifest via the canonical schema-push path (a oneoff script is fine). The dev drift gate skips disabled-component tables in its core sweep and treats manifest tables as "known" in the extra-table sweep, so dev boots unaffected.
- Pair with an idempotent self-heal migration (no-op when tables present) as belt-and-braces, but never rely on it alone — it protects one boot, not future publishes.
- After a dev DB reset, re-create these tables BEFORE publishing.
