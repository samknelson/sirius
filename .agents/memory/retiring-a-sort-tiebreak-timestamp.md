---
name: Retiring a bespoke created_at that a sort depends on
description: Moving a record's created-at into provenance changes WHEN it exists — after commit — so any ordering that used it needs a null rule, not just a repointed column.
---

# A bespoke created-at column that a sort depends on

A table's own `created_at` exists the instant the row is inserted, inside the
inserting transaction. Its provenance replacement does not: provenance is
written **after the mutation's COMMIT**, deferred and best effort. Repointing
a query from the column to the provenance date therefore does more than change
where the value comes from — it introduces a window in which the value is
absent for the newest row.

**The rule:** an ordering repointed onto provenance sorts the missing date
**FIRST** (newest), not last, and says why in the code. The reader that runs
inside the inserting transaction — typically the one maintaining a
denormalized "current" pointer — sees no provenance row for the row it was
called about, and last place would silently make a brand-new entry lose its
own tiebreak.

**That alone is not enough, and this is the part that gets missed:** *two*
rows can be waiting for provenance at once (created back to back, or in one
transaction). Both read as absent, the final id tiebreak picks one, and the
page — reading later, once both have real recorded times — picks the other.
Nothing recomputes the pointer afterwards, so the disagreement is permanent.
The write path must therefore NAME the row it just inserted to whatever
decides the order, so that row wins its group exactly as its recorded-at
eventually will. Only the create path passes it: an update leaves the
recorded-at alone, and an edited row must not jump rows recorded after it.

**Why:** the two readers of such an ordering (the page badging "Current" and
the denormalizer writing the pointer) must agree. If the in-transaction reader
puts the new row last and the page, reading later once provenance has landed,
puts it first, the pointer and the display disagree about which record is in
force — and neither is obviously wrong on inspection.

**How to apply:**

- Define the order once. A pure comparator over plain rows beats a shared SQL
  fragment here: both readers provably apply the SAME rule, the pending-row
  hint has somewhere to live, and the whole thing is unit-testable without a
  database (which is what lets the regression test clear this project's bar).
  Employer-scoped history sets are small enough to sort in memory.
- Match the provenance row on `entity_id` **and** `table_name`; entity ids are
  unique table-wide, but a row naming another table is someone else's history.
- Seed before you drop, in that order and in separate migrations: the shared
  seeding routine, then the `DROP COLUMN`.
- Retiring the column also means deleting its inventory-doc row and its
  lint-allowlist entry in the same change — the rule fails on an allowlist
  entry whose column no longer exists, so the two cannot drift apart.
- Seeded rows know WHEN but never WHO. Both the display and its wording have
  to survive "recorded, person unknown" — that is the permanent state of every
  pre-existing record, not a transient one.
