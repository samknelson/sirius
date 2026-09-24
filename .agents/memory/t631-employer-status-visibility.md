---
name: T631 employer status visibility
description: Employers may only see interviews in EMPLOYER_VISIBLE_STATUSES; every new surface must re-enforce this.
---

# T631 employer interview status visibility

Employers only ever see T631 job interviews whose status is in
`EMPLOYER_VISIBLE_STATUSES` (accepted/passed/failed) from
`server/modules/sitespecific/t631/interview-rules.ts`; the routes 404 hidden
statuses to employer callers.

**Rule:** any NEW surface that exposes interview data to employer contacts
(notifications, exports, emails, reports) must independently enforce this set —
both at config save time and at runtime — or it becomes an information leak
that bypasses the route-level enforcement.

**Why:** the interview notifier initially allowed an admin to configure
employer notifications for "offered"/"declined", leaking statuses the UI hides.

**How to apply:** import `EMPLOYER_VISIBLE_STATUSES` (pure module, safe
anywhere) and gate both the JSON-Schema (`allOf` if/then on recipient kind) and
the runtime dispatch path — the runtime guard also covers pre-existing configs.
