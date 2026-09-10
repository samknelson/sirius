---
name: Record-history admin surface
description: How the provenance (entity_metadata) admin page decides which tables it may name in SQL, and the count-vs-write agreement rule that makes its backfill terminate.
---

# Declaring the tables a provenance surface may name

A cross-table provenance list has to interpolate a raw table name into SQL (no
bind parameter can name a table), and the table name it works from is *data*
written by whatever logging config declared it. Three gates before the name
reaches SQL text: declared in a hand-written registry, shaped like a plain
identifier, and vouched for by the database itself.

**A boot assertion is what keeps the registry honest.** The logging middleware
records every raw table name its configs mention as it wires them; the
assertion (run at the end of route registration, after every module has wired
its own configs) fails the boot if a logged table is undeclared or a declared
table is absent from the schema. Storage wired later still — on component
enable — is caught on the next boot with that component on, which is the
accepted gap.

**Why:** without it the registry silently rots: a new logged table just never
appears on the page, and nobody notices for months.

**How to apply:** any surface that enumerates "all the kinds of record" needs
this pairing — a declared list plus a boot-time check against the thing that
actually produces the entries.

## Availability is asked of the database, not declared

Do **not** put a `component:` field on such a registry to say which entries are
unavailable. A component-owned table does not *exist* while its component is
off, and existence is exactly what the count needs — so ask the database
(reusing the sweep's own table verdict) instead of maintaining a second answer
that drifts. Refusals then carry the verdict's own words ("no such table",
"no id column to join on", "id column is integer").

## Count and write must share one predicate

**A backfill's "how many are missing" query and its "which ones will I write"
query must select exactly the same records — including the id-shape rule the
write applies in memory.**

**Why:** if counting is the looser of the two, a record the write passes over
stays counted as missing after every run. The count never reaches zero, the
page goes on saying "run again to continue", and a stray unwritable row can
consume the whole batch limit on every press. Found in review, not in testing —
the dev data had no stray ids.

**How to apply:** express the in-memory admission rule (here: the UUID shape)
as a SQL predicate kept literally beside the JS one, and build both queries
from one shared fragment. Keep the in-memory check as a last word and *count*
its rejections, so a future divergence between the two spellings shows up in
the run's result instead of as a batch that quietly writes nothing.
