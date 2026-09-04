---
name: Drizzle renders columns unqualified in a single-table select list
description: Why reusing one sql`` fragment in both WHERE and the select list can silently change its meaning and break correlated subqueries.
---

## The rule

A column interpolated into a `` sql`` `` fragment does NOT render the same way
everywhere:

- in a WHERE clause → `"grievances"."id"` (qualified)
- in the select list of a **single-table** select → `"id"` (bare)

Add a join and the select list starts qualifying again. So the rendering of a
fragment depends on the shape of the statement it is dropped into.

**Why it bites:** the natural pattern of building one boolean fragment and
using it twice — once in `.where()` to filter, once in `.select()` to report
what the row matched on — silently produces two different SQL texts. If the
fragment is a correlated subquery, the bare form is ambiguous against whatever
the subquery joins (`column reference "id" is ambiguous`) and Postgres refuses
the whole statement. A multi-table select hides the bug entirely, so it appears
only when someone removes a join.

**How to apply:** never interpolate a column directly as a correlated
reference. Render it explicitly qualified — the table object plus
`sql.identifier(column.name)` — so it means the same thing in both positions.

## Testing it

Drizzle produces the SQL without a database: build the statement against
`drizzle.mock()` and assert on `.toSQL().sql`. Assert the select list
separately from the WHERE clause (split on the LAST ` from `, since subqueries
carry their own) — a test that only exercises the filter passes while the
select list is broken.

Tests that stub the storage layer cannot see this class of bug at all.
