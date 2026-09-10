---
name: Entity metadata maintenance
description: How the entity_metadata provenance table is kept current — it rides the storage logging middleware, best effort, with per-record ordering held in the process.
---

# Entity metadata rides the logging middleware

Record provenance (created/modified/subrecord-modified date + user) lives in one
table keyed by the record's own id, and is maintained **in application code by
the storage logging middleware**, not by database triggers.

**Why:** the logging middleware is already the one place that knows, for every
mutation, which record changed, who the effective actor was, and when it
completed. A trigger knows none of that (no request context) and would have to
be written per table.

**How to apply:**

- A storage logging config MUST declare the raw `table` its records live in —
  it is a required field precisely so the compiler, not a reviewer, enforces
  coverage when a new config appears.
- Every logged method counts as a modification unless it says otherwise. Name
  prefixes (`create*`, `delete*`, the bulk family) pick the default; anything
  whose name doesn't reveal its intent has to state it (a method like
  `clearForJob` that deletes a row is the case that bites).
- The log's entity id is only *usually* the record's own id — configs report
  parents, human labels, and batch summaries. Anything that isn't a UUID is
  refused, and a config whose log id belongs to a different row has to name a
  separate resolver (or opt out) rather than filing one record's provenance
  under another's.
- A module whose key isn't a record id at all (the session store, keyed by a
  cookie id) exempts itself at the config level. Leaving it in means every
  routine operation produces a refusal warning.

## Best effort, and off the caller's transaction

The maintenance runs deferred, outside the caller's transaction, and swallows
its own failures separately from the log write.

**Why:** provenance must never be able to fail, slow, or roll back the business
mutation that produced it. Escaping the ambient transaction context is not
optional — an async context propagates into `setImmediate`, so without it the
writes reach for a client whose transaction has already committed.

But deferring is not the same as waiting for the commit, and this is the trap:
a storage method returns while its enclosing transaction is still open, and the
deferred write lands on its own connection. Scheduled off the method's return,
provenance survives a rollback the record itself did not — a row for a record
that never existed. Provenance is therefore scheduled by the COMMIT
(`onAfterCommit`, which fires immediately when there is no transaction), not by
the call. The log write, which describes an attempt rather than a record, is
still scheduled off the return.

## Ordering is held per record, in the process

Deferred callers are unordered: an edit and the delete that follows it can
reach the maintenance module in either order, and two statements racing in the
database settle by whichever lands last — a deleted record's row resurrected,
or a live record's row missing. So maintenance for one id is serialized
in-process, and a deletion marks the window: writes still queued behind it are
for a record that no longer exists and are dropped.

Monotonicity (`LEAST`/`GREATEST`/`COALESCE` in the upsert) only protects
*upserts* against each other. It says nothing about a delete racing an upsert,
which is why the ordering is needed on top of it.

## Timestamps are written as raw SQL on purpose

The upserts are raw `sql`, not drizzle. Drizzle's timestamp mapper writes UTC,
while this codebase's naive timestamp columns hold wall clock in the process
zone; going through the pg driver keeps the two consistent.
