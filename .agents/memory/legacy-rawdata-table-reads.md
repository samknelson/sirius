---
name: Reading a legacy system that can only page raw tables
description: Rules for copying data out of the Freeman-style legacy Drupal service, whose only read action is "select * from <table> order by <col> limit <n> offset <m>".
---

The legacy service exposes one read action that runs literally
`select * from <table> order by <col> limit <n> offset <m>`. It cannot filter,
cannot count, and never says whether more rows exist. Everything below follows
from that.

## A refusal must never be read as the end of a table

The only end-of-table signal is a short page — so a page that FAILED is
indistinguishable from the end unless the reader is explicit about it. Failures
arrive in more than one costume: an unknown table name is an HTTP 500, but a
query the service dislikes can be an HTTP 200 whose inner envelope carries
`success: false`.

**Why:** treating a refusal as the end quietly stages a fraction of a table as
though it were all of it, and every later stage then reasons about a truncated
copy it believes is complete.

**How to apply:** every table read reports HOW it stopped (complete / cap /
refused), and only "complete" is allowed to trigger a write. Parse fail-closed:
require the inner success flag to be exactly `true`, and refuse a page whose
record list contains anything that is not a row — silently dropping a bad
member shortens the page, which is precisely how the walk decides the table
ended.

## Read everything before writing anything

Both sweeps buffer the whole read, then write. A sweep that dies mid-table
leaves the previous complete copy untouched rather than a half-replaced one,
and the write phase itself runs in one transaction so a chunked or per-row
write cannot half-land either.

## A legacy field table's name is not derivable from its purpose

Drupal keeps each field in its own `field_data_field_*` table, and on an old
site those names record the feature the field was FIRST built for, not the one
it now serves — several EDLS sheet fields are named for grievances. Guessing
names silently under-collects: a missing table looks exactly like a field
nobody filled in.

**How to apply:** read `field_config_instance` and filter by the bundle to get
the authoritative list, then confirm each name answers. Those tables also hold
rows for other entity types and keep deleted rows, so filter by `entity_type`,
`deleted = 0`, and the id set you actually staged; multi-valued fields appear
as several rows differing by `delta` and all of them matter.
