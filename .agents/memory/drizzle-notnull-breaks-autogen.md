---
name: Drizzle .notNull() breaks null-autogenerate insert flows
description: Making a column .notNull() (no default) forces $inferInsert to require it, breaking storage flows that pass null and generate the value.
---

Adding `.notNull()` (with no `.default`) to a Drizzle column makes its
`$inferInsert` field a REQUIRED string. Any storage path that intentionally
passes `null`/empty and generates the value in code will then fail type-check
at the `.insert().values(...)` / `.update().set(...)` call site.

**Fix pattern (used for grievances.sirius_id):**
- Keep the zod insert schema field optional/nullable via `.extend({ field: z.string()....nullish() })` so callers/routes that pass null still type-check.
- At the Drizzle write site, build the payload so the field is a *definite* string: `.values({ ...data, field })` where `field` is the narrowed generated-or-provided value; for update, destructure the raw field out of the spread and only assign `values.field` when definite (type `values` as `Partial<typeof table.$inferInsert>`, not `Partial<InsertX>`), otherwise omit it.

**Why:** the zod `InsertX` type and Drizzle `$inferInsert` diverge — the zod type stays nullable, but `.set()`/`.values()` use `$inferInsert` which now forbids null.
