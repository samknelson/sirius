---
name: Optional unique text field — blank must become NULL
description: How to normalize an optional, uniquely-constrained text column in a shared insert schema so blanks don't collide and partial updates don't clear it.
---

# Optional unique text field: blank means absent

For a nullable column with a UNIQUE constraint (external-id style fields such as
`sirius_id`), normalize in the shared insert schema, not in the route:

```ts
field: z.string().trim().nullish().transform((v) => (v ? v : null)).optional(),
```

**Why each piece:**
- `.trim()` + `transform` — an empty string is a real value to Postgres. Without
  this, the SECOND record saved with an empty box collides with the first. Only
  NULLs are exempt from UNIQUE.
- The OUTER `.optional()` — makes the object key genuinely optional, so zod
  short-circuits on an absent key and never runs the transform. Without it,
  `.partial()` still parses a missing key as `undefined`, the transform turns it
  into `null`, and every unrelated partial update silently clears the field.
- Because the create path also treats an absent key as `undefined`, the column
  just falls to its NULL default — no separate create/update handling needed.

**How to apply:** any optional unique text column reachable from a form where the
input can be left blank. Pair it with:
- Drizzle column-level `.unique()` + a migration that adds a NAMED UNIQUE
  CONSTRAINT (not a unique index), or the startup drift gate refuses to boot.
- A 23505 branch in the route catch that checks BOTH `error.code === '23505'` and
  the exact constraint name, returning 409 with a message naming the field.
  Matching on the code alone would mislabel every other unique violation on the
  same table. Generic catch blocks otherwise collapse this into a 500 that never
  tells the user which field is duplicated.
- A client edit form that sends `null` (never `undefined`) when the box is
  cleared — an explicit payload object drops `undefined` keys and clearing
  becomes a silent no-op.
