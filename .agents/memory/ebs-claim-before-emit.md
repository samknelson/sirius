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
