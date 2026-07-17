---
name: Event-driven case creation must resolve people as-of the event date
description: Listeners that fan out per covered person must use as-of lookups, not "current active" state.
---

Rule: when an event listener creates records for the people affected by a past-dated event (e.g. COBRA cases for dependents on a terminated benefit month), resolve the affected set **as-of the event's effective date** (e.g. `getActiveByWorkerAsOf` with the last day before the effective month), never via the "current active" lookup.

**Why:** rescans, backfills, and delayed event processing replay events whose effective month is in the past; a current-state lookup targets today's dependents, creating cases for people who never lost coverage and missing those who did.

**How to apply:** any `eventBus.on` handler whose payload carries a month/year or effective date and which enumerates related people (elections, relations, memberships) should thread that date into an as-of storage method. Also: qualification guards should require a positive trigger (at least one qualifying reason), not just "no disqualifying reason".
