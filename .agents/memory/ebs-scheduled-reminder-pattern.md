---
name: EBS scheduled-reminder denorm plugin pattern
description: How to add a "N days before/after a moving date" reminder on the EBS scheduled-event-bus framework without touching the framework.
---

# Adding a scheduled reminder on the EBS framework

A reminder that fires N days before/after some date is implemented as a pair:
a **denorm plugin** (schedules `ebs_denorm` rows) + an **event-notifier plugin**
(delivers when the generic EBS pump fires). No EBS framework change and — if it
reuses existing source tables — no schema change/migration. Two live examples:
`tos_absence_reminder` (days AFTER absence start) and `grievance_deadline_reminder`
(days BEFORE a step due date).

**The one non-obvious design rule — encode the moving anchor into the entity id.**
The synthetic denorm entity id must include the anchor date (e.g.
`grievance-deadline-reminder:<gid>:<stepId>:<offset>:<dueYmd>`). When the anchor
moves, the new date produces a *different* id: `findWidows` retires the old row
and `backfill` schedules a correctly-timed new one. If you don't encode it, a
shifted deadline silently keeps firing the old reminder.

**Correctness does NOT depend on the hourly widow sweep beating the hourly pump.**
`isScheduledEventLive(uniqueId)` is the pump's pre-fire re-check against live
state — return false when the source row is gone/closed or the encoded anchor no
longer matches live. That, not `findWidows`, is what guarantees a completed/
moved/deleted item never delivers a stale reminder. `compute` should also throw
on those same stale conditions.

**Parse `YYYY-MM-DD` anchors to LOCAL midnight** (`new Date(y, m-1, d)`), never
`new Date(ymd)` (UTC → off-by-one). Do day math from that anchor.

**Storage rule still applies:** all the anti-join/lookup queries live in a
storage method (e.g. `grievance-steps-denorm.ts` `listOpenStepsWithDueDate` /
`getOpenStep`); the plugin only calls `storage.*`.

**Latency optimization is optional + additive:** raw `eventBus.on(<sourceChanged>)`
that eagerly enqueues the affected subject's missing candidates as `stale`. It
MUST be guarded (`isCacheInitialized`, component enabled, config enabled) and
wrapped in try/catch — never throw into the event bus. Removal always still
flows through `findWidows` + `isScheduledEventLive`.

**Offsets are "admin-configurable" via `config.data.offsets`** read in
`resolveOffsets()` with a `DEFAULT_OFFSETS` fallback — there is no schema-driven
UI field for them (same as the sibling). Keep them whole days (`Number.isInteger`)
since the day-based date math truncates fractions silently.

The denorm config is a `singleton: true` plugin → auto-seeded at boot by the
singleton-seeder. The notifier config is NOT auto-seeded (notifiers aren't
singletons) → an admin creates it and picks roles/channels.
