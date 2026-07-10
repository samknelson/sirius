---
name: EBS pump at-most-once delivery
description: Why the scheduled event-bus (EBS) pump claims a terminal status row BEFORE emitting, and why partial-failure retry is deliberately unsupported.
---

The generic EBS pump (`ebs_pump` cron) fires deferred event-bus events keyed by
`unique_id`, with delivery tracked in the decoupled `ebs_status` table
(unique on `unique_id`, values `sent`/`expired`).

**Rule:** the pump must claim atomically BEFORE emit — insert the terminal `sent`
row via `INSERT ... ON CONFLICT DO NOTHING RETURNING` (`storage.ebs.claimForDelivery`);
only the caller that gets a returned row may emit. Losers skip.

**Why:**
- node-cron does NOT prevent overlapping runs (a slow run, or a manual "run now"
  concurrent with the scheduled tick), and multi-instance deployments run
  separate schedulers. Claiming after emit lets two runs both read the same due
  row and both emit → duplicate notifications. The unique constraint on
  `unique_id` makes the pre-emit claim the single winner.
- Retrying a partial handler failure is WRONG here: re-emitting the whole event
  re-runs the handlers that already succeeded, so a "leave unmarked to retry"
  branch causes duplicate delivery on the good handlers. So partial/total emit
  failures are logged, never retried.
- Trade-off accepted: a crash between claim and emit drops that one reminder.
  For a reminder system, dropping-once beats delivering-twice.

**How to apply:** any new EBS-style deferred/outbox firing loop follows the same
project claim convention (`FOR UPDATE SKIP LOCKED` / `ON CONFLICT DO NOTHING
RETURNING`, see `storage/wmb-scan-queue.ts` `claimNextJob`). Do not add a
retry-on-partial-failure path unless emits are made per-handler idempotent.

## Retention purge of a decoupled terminal-status table must be row-safe

The decoupled status table (`ebs_status`, no FK to `ebs_denorm`) must NOT be
purged by a fixed age off `created_at`. The scheduling row (`ebs_denorm`) can
outlive the status row, so dropping a `sent`/`expired` status while its event is
still in-window (`dont_send_after >= now`) lets `getDue` re-fire it — a re-send.

**Rule:** store a per-row purge cutoff on the status row derived from the event's
`dont_send_after` (here `purge_after = dont_send_after + retention`), and purge
only `WHERE purge_after < now`. Guarantees a status is dropped only once its
event is long out of the firing window.

**Also:** with a decoupled status + a re-enumerating denorm backfill, purging a
terminal status for a still-referenced `ebs_denorm` row causes `getExpiredUnfired`
to re-mark it every run (insert/delete churn). Fix in the denorm plugin, not the
pump: `backfill` must skip entities whose window is fully past (rolling horizon)
and `findWidows` must retire past-window rows even for still-open subjects, so the
`ebs_denorm` row is gone before its status is purged.
