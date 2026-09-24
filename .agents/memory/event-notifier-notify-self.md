---
name: event-notifier self-notification opt-out
description: When and why an event-notifier opts out of self-suppression (scheduled EBS reminders), and the actor/flash-summary decoupling.
---

The event-notifier dispatcher drops the acting user (from the request-context
ALS) from a notifier's recipients — "self-notification suppression" — so a user
isn't pinged about their own real-time action.

**Rule:** notifiers fired by the EBS pump (scheduled reminders, e.g. grievance
deadline, TOS absence) must set `notifySelf: true` so suppression is skipped for
them.

**Why:** a scheduled reminder is a *system* action, not the acting user's
action. Two failure modes without the opt-out: (1) the associated user who
created/last-touched the entity is silently dropped, and (2) an operator who
*manually* runs the pump (`POST /api/cron-jobs/:name/run`) executes inside their
own HTTP request, so their identity leaks into the emit and they suppress
themselves — the reminder silently reaches nobody even though `ebs_status` says
`sent`. (Auto-scheduled node-cron ticks have no request user, so the bug only
shows on manual runs.)

**How to apply:** keep suppression for real-time notifiers (grievance status /
assignment / settlement); set `notifySelf: true` on any notifier whose event is
emitted by the EBS pump. Keep the suppression actor and the flash-summary actor
decoupled in the dispatcher: `actingUserId` (always the request user) drives the
operator flash summary `recordSentNotification`; a separate `suppressionUserId`
(nulled when `notifySelf`) is what filters self-recipients. Nulling one variable
for both silences the operator's "sent N notifications" summary as a side effect.
