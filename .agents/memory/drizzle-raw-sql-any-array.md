---
name: Drizzle raw-sql ANY(array) fails in migrations
description: Why `= ANY(${jsArray})` throws in db.execute(sql`...`) and what to use instead
---

In a migration using `db.execute(sql\`...\`)`, binding a JS array into a Postgres
`= ANY(${jsArray})` clause fails at runtime with:

  `op ANY/ALL (array) requires array on right side`

**Why:** the drizzle `sql` tagged template binds the JS array as a single
parameter that Postgres does not coerce to a real array on the right side of
`ANY`.

**How to apply:** build an `IN (...)` list instead:

```ts
AND c.plugin_id IN (${sql.join(IDS.map((id) => sql`${id}`), sql`, `)})
```

This emits `IN ($1, $2, ...)` with each element bound separately, which Postgres
accepts. Applies to any raw-sql migration/storage query that needs to match a
column against a JS array of values.
