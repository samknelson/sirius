---
name: New jsonb column on a core table auto-leaks via storage reads
description: Adding a jsonb "data" (or any sensitive) column to a heavily-read core table silently exposes it through every generic read/return path.
---

Adding a new column to a core table (e.g. `workers.data` jsonb holding PII like
beneficiary SSNs) does NOT only flow through the one feature you built it for.
Every storage method that reads the row with a star select (`db.select()` with no
projection) OR writes with `.returning()` (no projection) returns ALL columns,
including the new one. Those rows are spread straight into generic API responses
(`/api/workers`, `/api/workers/:id`, every update endpoint), so the new column
leaks to anyone who can hit those endpoints — bypassing whatever component/policy
gate you put on the feature's own dedicated endpoint.

**Why:** Drizzle `.select()` and `.returning()` with no argument project the full
row. A type-only change (e.g. `Omit<..., "data">` on the exported select type) does
NOT stop the runtime leak — TS allows returning an object with extra props from a
function, and the value still carries the column at runtime.

**How to apply:** When you add a sensitive/internal column to a widely-read table:
1. Keep it OUT of the public select type (`Omit<typeof table.$inferSelect, "col">`)
   so no consumer is built to expect it.
2. Add a storage-layer strip helper and apply it at EVERY method that returns a
   row of that table to a caller (both star-select reads and `.returning()` writes).
3. Expose the column only through dedicated, narrowly-scoped accessors
   (e.g. `getData`/`setData`) used by the component-gated feature.
4. Grep for `.select()` (star) and `.returning();` (no projection) in the table's
   storage module to find every site — they all leak by default.
