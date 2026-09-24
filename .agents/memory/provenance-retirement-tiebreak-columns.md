---
name: Retiring a created_at that is also a tie-break
description: Why a provenance-looking timestamp can be load-bearing, and what decides whether it may be dropped
---

A bespoke `created_at` on a history table is often ALSO the tie-break in the
"which entry is current" ordering (`ORDER BY date DESC, created_at DESC, id
DESC`). Before retiring one, decide whether that tie-break can fire:

- If a unique constraint makes the business date unique per subject (e.g. one
  status per worker per industry per date), the tie-break is unreachable, the
  column decides nothing, and it retires. Drop the clause with the column and
  leave `id` only to keep the ordering total.
- With no such constraint, two same-date entries are a legitimate same-day
  correction and "entered last wins" is the answer. The column is business
  data — keep it, move it to the KEEP inventory + lint allowlist, and say so
  at the column in the schema.

**Why:** provenance (`entity_metadata`) is maintained best effort, after the
caller's transaction, so a lost provenance row must never be able to flip a
derived answer such as a worker's current status. Ordering keys that drive
behaviour have to be written by the mutation itself. Sibling tables that look
identical can legitimately end up on opposite sides of this call.

**How to apply:** when a retirement task names a column, check the table's
constraints first, then every ordering that mentions it. Seed provenance for
BOTH kinds of table anyway — a kept ordering key and a truthful record history
are different jobs, and the seeding routine is idempotent.
