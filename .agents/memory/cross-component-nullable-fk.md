---
name: Cross-component nullable pointer columns
description: Core table pointing at an optional-component table — no drizzle .references(), conditional FK in migration
---

Rule: a CORE table's pointer column to an optional-component table must be a plain varchar in `shared/schema.ts` (no `.references()`); add the DB FK conditionally in the migration only when the target table exists.

**Why:** importing an optional component's schema into core `shared/schema.ts` creates a module cycle, and the target table can be absent when the component is disabled. The startup drift gate does not compare foreign keys, so the asymmetry is safe.

**How to apply:** gate FK/backfill DDL on `information_schema.tables`; gate server-side enrichment of the pointer on `isComponentEnabledSync(<component>)`.
