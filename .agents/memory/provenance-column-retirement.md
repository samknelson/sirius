---
name: Retiring a bespoke provenance column
description: What a "retire table X's created_at/created_by" task actually costs — joining the framework, the seed migration, the ordering join, and the two nulls the reads must survive.
---

Retiring a table's own `created_at` / `created_by` columns into `entity_metadata`
is the same shape every time. `docs/provenance-columns.md` is the inventory and
the decision rule; this is what the doc does not say.

**Why bother:** the columns duplicate an answer the framework already gives, and
the framework's answer is strictly better — it can name the person, which a
timestamp column never could.


## Before any of it: the table has to be in the framework

Nothing writes `entity_metadata` for a table that is not under storage logging,
so a table that never had a logging config needs one FIRST — the create/delete
named methods already resolve to the `created` / `deleted` provenance modes by
name convention. Declare the table in the record-tables registry too: a boot
assertion keeps that registry honest, and it is what lets the orphan sweep
clean up rows whose record went away by cascade rather than by a logged delete.

## The recipe

1. **Two migrations, in this order and in separate files.** One seeds
   provenance from the columns with the shared seeding routine
   (`server/storage/system/entity-metadata-seed.ts`), one drops the columns
   with `DROP COLUMN IF EXISTS`. Split so a failed drop still leaves the seed
   applied, and both are re-runnable.
2. **Seed BEFORE dropping, never after.** The column is the only record of when
   the row was made; drop first and every row's creation date silently becomes
   the date of the migration. The seed routine wraps its own transaction (the
   migration runner does not) and reports rather than throws when the column is
   already gone.
3. **Repoint the reads**, then delete the columns from the schema *and* from
   every derived shape — the `.omit()` keys in the insert/upsert zod schemas
   name the column and stop compiling once it is gone.
4. **A list that SORTS on the date needs it joined, not fetched per row.** Read
   `entity_metadata` once for the whole table (`table_name = '<table>'`,
   `entity_id = <row>.id`) and hand the list a `createdDate` alongside the rows.
   A single record page can just ask `/api/entity-metadata/:id`.

**Expect to renumber.** These tasks run as a swarm off one inventory, so the
migration numbers you picked are usually taken by a sibling by the time your
branch rebases. Both files must survive being renumbered and re-run against a
database where they already applied — which is exactly what the IF EXISTS drop
and the non-fatal seed buy.

## The reads are the hard part, not the drop

A column that only DISPLAYS is easy. A column the queries ORDER BY becomes a
`LEFT JOIN entity_metadata ON entity_id = <record>.id AND table_name = '<table>'`
in every read that ordered by it — and the join has to carry the table name, or
a provenance row belonging to another table can answer.

Do the join ONCE, in the storage read, and hand the date out as a field. Two
surfaces reading the same list (a page and a dashboard widget, say) must not
each grow their own join.

**A descending sort on the provenance date puts unstamped rows FIRST**
(Postgres DESC defaults to NULLS FIRST), and that is the right place for them:
provenance is written after the capturing transaction commits, so the row with
no stamp yet is the one that was just written. Keep a `desc(id)` tiebreak so a
page boundary is stable. Paging over provenance-ordered rows is not stable
against a stamp landing mid-walk; say so where the pager lives.

**Check which method the live route actually calls before moving a sort.** A
storage method that orders by the column may have no caller at all, while the
list a user sees is ordered by a business date (a job's start date) and must
not change. Porting the provenance join into an uncalled method is worse than
useless — delete the dead method instead, and leave the visible ordering alone.

## Two different nulls, and neither is an error

- **No date** — the framework never wrote history for that record (best
  effort). The row still exists and must still list; say "not recorded" rather
  than invent a time.
- **No person** — a system path with no signed-in user did the write, or the
  account is gone. `withSystemActor`-style paths are normal, so "nobody" is a
  real answer.

**Why:** a retirement that fills either null with a guess (a synthetic user, a
fabricated `now()`) destroys the distinction the framework exists to record.

## What the seed migration can and cannot recover

`storage.entityMetadataSeed.seedFromColumns` takes date and person columns,
wraps its own transaction, is idempotent, and skips a missing table/column
non-fatally. It reads the person column THROUGH `users`, so a stale id becomes
nobody rather than an FK failure.

A denormalised NAME column (`author_name` and friends) is not seedable — the
framework names a person and resolves their current name at read time, which is
the point. Drop it; do not try to preserve the frozen string.

Only move what the column actually said. A `user_id` on the record is whose
record it is, not who created it; seeding it as the creator invents provenance
out of a foreign key.

## An upsert has to be asked which thing it did

The storage logging middleware infers creation from the method NAME
(`create*` / `delete*`, everything else "modified"). An `upsert` is invisible to
that rule and a static override lies in one direction or the other: mark it
`created` and every later repair restamps the record with whoever repaired it;
leave it `modified` and the one moment the real author was observable is thrown
away. `metadataMode` therefore accepts a FUNCTION, handed the same
`(args, result, beforeState)` as every other logging hook — a config with a
`before` hook answers `beforeState ? 'modified' : 'created'` and is right both
times.

**Why:** provenance fills a null creator with COALESCE, so a wrong `created`
does not merely mislabel one event — it permanently names the wrong person as
author of a record created long before.

## The change is not done until

The `<table>.<column>` rows leave the allowlist in
`scripts/dev/check-provenance-columns.ts` AND the RETIRE table in
`docs/provenance-columns.md` — the lint rule fails on an allowlist entry naming
a column that no longer exists, so leaving them behind breaks the gate either
way.

And grep raw SQL, not just the ORM: one-off scripts under `scripts/oneoffs/`
insert with hand-written column lists that typecheck cannot see.

## Renaming the field is the proof

Name the joined list field something NEW (`createdDate`, not `createdAt`): the
old name disappearing from API responses is how you know no response still
promises the retired column. A detail page should reuse the record-history hook
the history badge already uses rather than invent a second source.
