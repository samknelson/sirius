---
name: A plugin kind id is stored data, not a label
description: Why renaming a plugin kind is a data migration, and which DB names the drift gate actually enforces.
---

## The rule

A plugin kind's id is not a display name. It is at least three things at once:

- the `plugin_kind` discriminator written on every `plugin_configs` row;
- the name of the kind's subsidiary table, `plugin_configs_<id>`;
- the segment in its admin route (`/admin/plugin-configs/:kind`) and in whatever
  bespoke API the kind registers.

So renaming a kind is a data migration, never a find-and-replace. The code half
and the data half have to land together: flip the discriminator, rename the
subsidiary table, in ONE transaction (the migration runner does not wrap `up()`).
Miss the subsidiary and the generic config search — which INNER JOINs it — stops
returning the kind's configs entirely, silently.

**Why:** the subsidiary exists as a type-safe FK target, so other tables point at
it rather than at the polymorphic base. It is load-bearing for both reads and
referential integrity.

**How to apply:** before renaming a kind, search the database as well as the
repo — `plugin_configs.plugin_kind`, the subsidiary table, and any config/policy
row that might store the id as a string.

## Which database names are enforced, and which are fiction

The startup drift gate (`detectSchemaDrift`) compares:

- **foreign keys by signature** — `cols->ftable(fcols)` plus ON DELETE/UPDATE
  actions, NOT by name;
- **primary keys by column set**, NOT by name;
- **unique constraints by column set**, NOT by name;
- **CHECK constraints and indexes by name.**

This is deliberate: Drizzle's auto-generated names rarely match Postgres'.

The consequence is worth knowing before you plan a rename: an FK/PK/unique name
declared in `shared/schema.ts` can be pure fiction — differing from what is
actually in the database — and nothing will ever complain. Verify against
`pg_constraint` rather than believing the schema file, and do not add constraint
renames to a migration on the theory that the gate needs them. It does not.

**Why:** a rename plan that tries to keep declared names in sync with reality
grows enormous and risky for zero functional benefit. Renaming such a constraint
is cosmetic — worth doing only when the name itself has become a lie readable by
a human (e.g. it embeds a table that no longer exists).
