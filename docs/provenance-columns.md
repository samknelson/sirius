# Bespoke provenance columns

"When was this record made, and by whom?" has one answer in this codebase:
`entity_metadata`, one row per record, written by the storage logging
middleware (`server/storage/middleware/logging.ts` →
`server/storage/system/entity-metadata.ts`) and read by the record-history
badge and the admin metadata viewer. It covers every logged table at once,
names a person as well as a date, keeps a modified stamp, and keeps a
subrecord-modified stamp the tables never had.

The owner is stored in `entity_metadata.context_id`, using the stable context
ids declared by `server/storage/entity-metadata-record-tables.ts`. Logging
configs remain table-oriented, but the write boundary reverse-resolves their
physical table through that registry. This keeps storage and joins correct if
a future context id differs from its physical table name; callers should use
the context registry rather than treating the stored value as a SQL identifier.

Roughly two dozen tables predate that framework and carry their own
`created_at` / `updated_at` / `created_by` / `date_created` column. Each one is
a second, partial answer to the same question — usually date-only, never with a
person, and never kept in step with the framework the rest of the app reads.
They are being retired, one task per area.

This document is the inventory those tasks work from, the rule they follow for
the reads that depend on a retiring column, and the rationale behind the
allowlist in `scripts/dev/check-provenance-columns.ts`.

## The three shared pieces

1. **The seeding routine** — `storage.entityMetadataSeed.seedFromColumns()`
   (`server/storage/system/entity-metadata-seed.ts`). A core migration names a
   table and which of its columns hold the four facts; the routine fills that
   table's provenance rows from them, creating a row where none exists and only
   ever making a stamp *more* truthful: an earlier created date, a later
   modified date, a known person in place of an unknown one. It never replaces
   a real person with nobody and never moves a stamp backwards, so it is safe
   to run after the admin backfill has already stamped a record at backfill
   time — the seed's older, truer creation date simply displaces the backfill's
   "first sighting". It wraps its own transaction (the migration runner does
   not wrap `up()`), running it twice changes nothing the second time, and a
   table that does not exist because its component is off is skipped with a
   stated reason instead of failing the migration run.

   It does not guess. A record whose bespoke column holds only a date keeps an
   unknown person; a record that offers no date at all is passed over and
   counted, because a provenance row has to carry a date. A table that knows
   WHO but not WHEN must therefore name the earliest date it can honestly
   claim — a last-saved watermark is one, a fabricated "now" is not.

2. **This inventory**, below.

3. **The lint rule** — `provenance-columns` in the architecture-lint suite
   (`npx tsx scripts/dev/lint.ts provenance-columns`). It fails the build when
   a table in the shared schema gains a creation/modification date or person
   column that is not on its allowlist. The allowlist starts as the KEEP list
   below plus every column not yet retired; each area task deletes its own
   entries as it lands, so the list drains to just the operational timestamps.
   The rule also fails on an allowlist entry naming a column that is gone, so
   the two lists cannot silently drift apart.

## The decision rule for a read that depends on a retiring column

Every area task hits the same question — this screen shows the old column, what
does it read now? The answer depends on what the read is *for*, and there are
only three cases:

- **It only DISPLAYS the date.** Use the record history the badge already
  reads. The date the framework holds is the same date, resolved the same way
  everywhere, and it comes with the person the old column never had.
- **It SORTS or FILTERS on the date.** Read provenance
  (`entity_metadata.created_date` / `modified_date`), joined on the record id.
  Ordering and paging semantics stay as they were; the source moves.
- **It DRIVES BEHAVIOUR.** A change watermark an export diffs against, an
  ordering key a downstream system depends on, a cache's freshness, a
  rate-limit window — that is business data that happens to be a timestamp, not
  provenance. It stays. Move it from the RETIRE table to the KEEP table below
  with the reason, and add it to the lint allowlist.

The third case is the one to be honest about: a column is only a keeper when
something *reads* it to decide what to do, not when a screen happens to show
it.

## RETIRE — bespoke provenance, not yet moved

Every column here is on the lint allowlist until the task that owns it lands.
That task drops the column, repoints its reads by the rule above, and removes
its own rows from this table and from the allowlist.

| Table | Column(s) | Owning task |
| --- | --- | --- |
| `sitespecific_btu_csg` | `created_at`, `updated_at` | Retire BTU Table Timestamps |
| `sitespecific_btu_political_officials` | `created_at`, `updated_at` | Retire BTU Table Timestamps |
| `sitespecific_btu_political_worker_reps` | `created_at` | Retire BTU Table Timestamps |

Every column left here is a date and nothing else. The two that also carried a
person are done — `snapshots.author_id` and `edls_sheets.created_by` — and both
had records with nobody recorded. "No author" is a real state, and the seeding
routine preserved it rather than guessing. `snapshots` carried a third column,
`author_name`, a frozen copy of a display name, which was not seeded at all:
snapshots show the current name.

The BTU tables belong to an optional component and do not exist where it is
off. Their seeding migration relies on the routine's stated skip.

## KEEP — operational timestamps, not provenance

These stay. They are business data that happens to be a timestamp: something
*reads* each one to decide what to do. The lint rule allowlists the ones whose
names look like provenance; the rest never matched it in the first place and
are listed here so the inventory is complete.

| Table | Column(s) | Why it stays | On the lint allowlist |
| --- | --- | --- | --- |
| `flood` | `created_at`, `expires_at` | Rate-limit window: the pair decides whether a caller is over quota. | `created_at` |
| `wc_cache` | `created_at`, `fetched_at` | Cache freshness: the row's age decides whether the cached answer may still be served. | `created_at` |
| `sitespecific_btu_political_district_cache` | `created_at`, `looked_up_at` | Cache freshness for a billable district lookup. | `created_at` |
| `comm_inapp` | `created_at` | Message send time: shown to the recipient and orders their inbox. | yes |
| `comm` | `sent` | Message send time, and the ordering key for single-link write-back. | no |
| `events` | `created_at` | Event emission time — the happening, not a record's history. | yes |
| `event_occurrences` | `created_at` | Event emission time. | yes |
| `event_participants` | `registered_at` | When a participant registered: business data about the registration. | no |
| `ebs_status` | `created_at`, `purge_after` | Event-bus scheduling state: read by the pump and the retention purge. | `created_at` |
| `edls_sheets` | `changed` | Change watermark: drives changed-since export filtering, passport export ordering and a notifier. Refreshed by the storage layer on every save. | yes |
| `user_roles` | `assigned_at` | Join table with no record id of its own, so provenance cannot key it at all. | yes |
| `role_permissions` | `assigned_at` | Join table with no record id of its own. | yes |
| `worker_wsh`, `worker_msh` | `date` | The status's EFFECTIVE date — which day the worker held that status — not when the row was written. | no |
| `worker_wsh` | `created_at` | Tie-break ordering key. Nothing stops a worker holding two work-status entries for one effective date, and the entry made LAST is the current status — read by `getCurrentWorkStatusId` and the HTA inactivity scan, and through them by the `worker_ws` denorm and dispatch eligibility. See the note below. | yes |
| `employer_policy_history` | `date` | The policy assignment's effective date. | no |
| `wizards` | `date` | The run's business date. | no |
| `wizard_report_data` | `created_at` | Bulk output of a report run, one row per result row. The data-retention purge reads a row's age to decide whether the run's output has outlived its wizard's retention setting, and it is the order the rows are read back in (the results table and the EDI file both). Same call as `ebs_status`. | yes |
| `ledger` and payment batches | `date` | Accounting dates. | no |
| `winston_logs` | `timestamp` | The log entry's own time; the entry IS the event. | no |
| `entity_notes` | `timestamp` | A note's posted time, shown on the note. | no |
| `sessions` | (all) | Cookie-keyed session store, not a record table. | no |
| `sitespecific_btu_political_worker_reps` | `last_looked_up_at` | Freshness of a billable lookup, distinct from that table's retiring `created_at`. | no |
| `snapshots` | `captured_at`, `captured_by` | Capture provenance for process snapshots; kept on the snapshot so excluding snapshots from record history does not erase the browser's timestamp or actor. | no |
| `ledger_payments` | `created_at` | Payment creation time displayed and ordered by payment lists; ledger tables are intentionally excluded from record history. | `created_at` |
| `ledger_paymentmethods` | `created_at` | Payment-method creation time displayed and ordered by payment-method lists; ledger tables are intentionally excluded from record history. | `created_at` |

`entity_metadata`'s own `created_date` / `created_by` / `modified_date` /
`modified_by` / `subrecord_modified_*` columns are the framework itself, and
the lint rule exempts the table outright.


### Why the two worker status history tables ended up on different sides

`worker_msh` and `worker_wsh` carried the same column, written the same way,
and were read by the same clause: `ORDER BY date DESC, created_at DESC NULLS
LAST, id DESC`, picking the worker's current status. They still parted company,
because a constraint decides whether that clause can fire at all.

`worker_msh` is unique on (worker_id, industry_id, date), so one worker cannot
hold two member statuses for one industry on one date: the tie-break was
unreachable, the column decided nothing, and it retired (migration 1099) with
its dates seeded into provenance first (migration 1098). The orderings now say
`date DESC, id DESC` and return exactly what they returned before.

`worker_wsh` has no such constraint. Two work-status entries for one effective
date are a same-day correction, the later entry is the worker's current status,
and that answer feeds the `worker_ws` denorm and dispatch eligibility. The
ordering key therefore has to be written by the mutation itself: provenance is
maintained best effort, off the caller's transaction and after it commits, so a
dropped provenance row could otherwise flip a worker's current work status. Its
records are seeded into provenance all the same — the column staying is about
what the ordering reads, not about where the record's history lives.
