---
name: drizzle-kit push hazards
description: Why db-push churns or destroys constraints, and the naming rules that make it converge
---

# drizzle-kit push hazards (dev-loop `scripts/db-push.ts`)

## The 63-char identifier truncation churn
Postgres truncates identifiers to 63 bytes. drizzle-kit auto-generates
constraint names like `<table>_<cols>_<ftable>_<fcols>_fk` that often exceed
63 chars; PG stores the truncated name, but push diffs by the FULL name, so
every run drops and re-adds the same constraint forever ("Changes applied"
never converges to "No changes").

**Rule:** any composite unique or FK whose auto-name would exceed 63 chars
must pin an explicit name (≤63, matching the live DB conname exactly):
- uniques: `unique("name").on(...)` — also declare columns in TABLE order
  (push compares column order against pg_constraint conkey order).
- FKs: inline `.references()` cannot take a name — convert to an extraConfig
  `foreignKey({ name, columns, foreignColumns }).onDelete(...)` builder.

## Non-interactive push destroys constraints on failure
`drizzle-kit push` auto-applies without prompting in this setup. A run that
dies mid-way (e.g. on a SET NOT NULL 23502) leaves whatever DROPs it already
executed — one incident silently dropped ~160 FKs + a composite PK before
failing. Always snapshot `pg_constraint` before/after a push run and diff.

## jsonb default churn
`.default('{}')` on a jsonb column churns (`SET DEFAULT '{}'` every run)
because DB introspection reports `'{}'::jsonb`. Declare
`.default(sql`'{}'::jsonb`)` instead.

## FKs pointing at absent disabled-component tables
The startup drift gate skips expected FKs whose target table doesn't exist;
drizzle-kit instead tries to CREATE them → 42P01. `scripts/db-push.ts`
mirrors the gate by stripping inline FKs targeting omitted tables from the
generated runtime schema (symbol `drizzle:PgInlineForeignKeys`). It must NOT
exclude the referencing table itself — push drops tables missing from the
schema.

## Why the drift gate doesn't catch what push flags
The gate compares column sets/types, structural FK signatures (skipping
absent targets), and named constraints — it does NOT diff constraint-name
spelling beyond presence, nullability of defaults, or column defaults. So
"gate passes, push churns" almost always means name/default cosmetics, not
real drift.
