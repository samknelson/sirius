---
name: Flood framework reuse for new rate caps
description: How to add a new rate/throttle cap by reusing the existing flood-protection framework instead of building new infra.
---

# Reusing the flood framework for a new rate cap

When you need a "no more than N per window" cap on anything, reuse the existing
flood framework rather than inventing new tables/counters.

**Rule:** register a `FloodEventDefinition` (name, threshold, windowSeconds,
`getIdentifier(context)`, optional `resolveIdentifierName`). You get for free:
- Admin tunability — every registered event auto-appears in the flood-config
  admin UI and its threshold/window are overridable via a `flood_<name>`
  variable, loaded at boot by `loadFloodConfigFromVariables()`.
- Storage + cleanup — counts live in the existing `flood` table; an hourly cron
  purges rows past `expiresAt`. So **no schema change and no migration** are
  needed for a new cap.
- Admin viewer name resolution via `resolveIdentifierName`.

**Composite buckets:** `getIdentifier` returns ONE string, so encode a
multi-dimension bucket by joining keys (e.g. `contactId|pluginId`). Put the
dimension you want *separate thresholds* for into the event NAME (one event per
value), and the dimensions that only need separate *counting buckets* into the
identifier. (Notification flood caps: one event per medium — different tunable
thresholds — with identifier `contactId|pluginId` for per-recipient/per-plugin
isolation under a shared threshold.)

**Enforcement pattern:** at the send/action site, call `checkFlood(name, ctx)`;
if `allowed`, call `recordFloodEvent(name, ctx)` then proceed, else skip+log.
`enforceFloodLimit` does check-then-record but THROWS a `FloodError` on block —
avoid it where a throw would be miscaught as a generic failure; prefer the
explicit check+record so you can skip cleanly.

**Threshold 0 as an off switch:** if a cap treats `threshold <= 0` as "feature
disabled", remember the surrounding plumbing must accept 0 explicitly — the
flood-config API zod schema, the boot-time variable loader (a truthiness check
on `config.threshold` silently drops 0), and the admin UI input (`parseInt(x)
|| 1` coerces 0 to 1). All three were fixed to allow 0; keep them that way.

**Fail OPEN:** wrap the check so a check/record error still lets the action
proceed — throttling infrastructure must never silently swallow legitimate
sends. Also enforce only once the action is known to be deliverable, so no-op
attempts don't consume budget.
