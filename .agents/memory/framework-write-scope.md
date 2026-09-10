---
name: Framework writes vs audit entries
description: How a boot-time/self-heal write keeps its provenance stamp but leaves no audit-log entry, and why shouldLog cannot do it.
---

A write the framework performs on its own behalf (legacy backfill, component
self-heal, seeding a row a plugin needs) must be recorded as provenance with
NO person, and must NOT add an audit entry on every restart.

**Do not reach for the logging config's `shouldLog`.** In the storage logging
middleware `shouldLog` is consulted *before* the entity-metadata scheduling, so
suppressing it also suppresses the provenance stamp — the opposite of what is
wanted. The separation lives in the ambient request context instead: a nested
scope that clears the actor (as `withSystemActor` does) and sets a flag the
middleware reads immediately after it schedules the metadata write and before
it defers the audit entry. Provenance survives, the audit entry is dropped, and
the error path is untouched so failures still log.

**Why:** an audit row is "somebody did this"; a self-heal is nobody's doing and
repeats every boot, so it is both untrue and noise. But "when did this row
appear" still has to be answerable, which is the provenance row.

**How to apply:** scope the flag around the WRITE, not around the boot step.
Several of these paths (component reconcile, subsidiary backfills) also run
inside an administrator's request, and that run must keep attributing to the
administrator. Wrapping a whole init function also silences unrelated tables
the same function touches (e.g. retiring a legacy `variables` row, which IS
worth logging).
