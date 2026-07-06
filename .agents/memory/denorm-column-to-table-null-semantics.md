---
name: Replacing a nullable scalar denorm column with a derived multi-row table
description: Preserve null/absence semantics when migrating a nullable denorm scalar into a derived table; don't fabricate a default.
---

# Nullable scalar denorm column -> derived table: keep the "absence" case

When you replace a nullable scalar denorm column (e.g. a worker's
`denorm_home_employer_id`) with a derived multi-row table + flag (e.g.
`worker_employment_denorm.home`), the correct invariant is usually **at most
one** flagged row, NOT exactly one.

**Why:** the legacy column was nullable, and real consumers branch on its
*absence* (e.g. pension-sla skips workers with "no home employer assigned",
my-steward / csg have no-home code paths). Forcing a fallback ("if none
flagged, pick the first") fabricates a value that never existed and silently
changes business logic for those consumers. A code reviewer reading only the
new schema comment may push for "exactly one" — verify against the legacy
nullable behavior before adding a fallback.

**How to apply:** in the derive method, set the flag only when the source row
is genuinely flagged; otherwise emit zero flagged rows so home-derived reads
resolve to null. Word the schema/migration comment as "at most one ... (a
worker may have none)". If you want a DB-level guard, use a *partial* unique
index `(entity_id) WHERE flag = true` (allows zero), never a plain NOT NULL /
exactly-one constraint.

Also: when a DTO field becomes optional because only some read methods now
populate it, grep every consumer of the methods that DON'T populate it to
confirm none read the field (it will be `undefined` at runtime, not null).
