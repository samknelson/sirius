---
name: Cron tick heartbeat
description: What the shared wall-clock tick events promise, why periodic plugin work goes on a tick instead of a bespoke cron, and the two things that get this wrong.
---

# The shared cron tick

One singleton cron job emits wall-clock heartbeat events (one distinct
`EventType` per period, sharing one payload). Anything that needs waking up
regularly subscribes to the period it wants instead of registering a cron job
of its own.

**Why one event type per period, not one type with a period field:** the bus
routes by type, so a per-period type means a subscriber is woken only for the
period it asked for. A single type would wake every subscriber on every tick
and push the filtering into each handler.

**Why no separate "evaluator" between the tick and the plugin:** the
event-notifier dispatcher already fans one bus event out to every enabled
config of every subscribing plugin, and hands each config's own data to
`shouldDispatch`. So a notifier subscribing to a tick gets exactly what a
bespoke scan cron used to compute for it. Threshold/decision logic belongs in
the plugin; nothing outside it should know what its rules mean.

## The contract — best-effort, level-triggered

A tick is a prompt to go and look at current state. It is not a unit of work.
No exactly-once (overlapping runs and multi-instance both duplicate), and only
ONE catch-up tick per period however many boundaries were missed.

**How to apply:** a tick subscriber must be idempotent and must re-derive
everything from current state. Work that must happen exactly once at a moment
known in advance goes in the EBS deferred scheduler instead — that claims its
row before emitting, which is precisely the guarantee ticks decline to offer.

## Alignment and dueness

Periods anchor at LOCAL MIDNIGHT (hourly = on the hour, daily = local
midnight), so a restart cannot shift the phase and two processes agree on the
current slot without coordinating.

Dueness compares the slot now against the slot at the **previous live
successful run** — never against the schedule. The schedule is an
operator-editable setting, the process can be down, and a run row is created
*before* the run executes.

**Why:** "latest run" is the wrong question three ways at once — it returns the
row for the run currently in flight, a test-mode run, or a run that failed
without emitting. Ask for the last live success specifically.

## Do not put a "how late is this" count on a heartbeat

An earlier version carried a `late` boolean computed as
`slotStart - periodMinutes*60000`. That is fixed-millisecond arithmetic over
civil-time slots, and it is wrong twice a year: a local day is not always 24
hours, so a punctual daily tick reads as late after the fall-back.

**Why the fix was deletion, not civil-time math:** nothing consumed the flag,
and nothing could legitimately act on it — only one catch-up tick is emitted
per period, so any count of skipped boundaries describes work that will never
be done. The boundary timestamp in the payload is exact; a subscriber that
wants to know how far behind a tick arrived compares it against its own clock
and needs no lateness policy at all.

## Retiring the cron a tick replaces

Deleting a cron plugin leaves its `plugin_configs` row an orphan — the
scheduler warns "No plugin registered" on every boot and the admin cron page
shows a dead entry. A core migration must delete the row (the cron subsidiary
row cascades). Leave `cron_job_runs` history alone; it is a record of what
happened and ages out.

## Cost of the centralization

Coupling is centralized, not removed: disabling the emitter silences every
subscriber at once, and each one still looks healthy. That is the accepted
trade (it is at least *one* visible dependency rather than several invisible
ones), and the job's admin-visible description has to say so.
