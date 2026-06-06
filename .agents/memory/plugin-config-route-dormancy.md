---
name: Plugin config route dormancy (legacy vs unified)
description: Why an "additive" generic config router is not automatically dormant for a kind that already owns legacy routes.
---

When a generic `/api/plugins/:kind/configs` router is added alongside a kind's
pre-existing dedicated config routes, route-order precedence (register generic
AFTER legacy) only shadows the generic handlers for HTTP methods the legacy
surface also defines. If the legacy charge routes use `PUT` for update but the
generic router uses `PATCH`, the generic `PATCH` (and `search`) are NOT shadowed
— they become a second, divergent write surface against the new (empty) unified
tables.

**Rule:** keep an explicit allow/deny gate (e.g. a `LEGACY_OWNED_KINDS` set in
`server/modules/plugins-config.ts`) so the generic routes refuse any kind that
still owns authoritative legacy storage, until that kind is actually cut over.
Remove the kind from the set in the same task that migrates its data and retires
its legacy routes.

**Why:** "additive only / nothing visible changes" can be silently violated by
method-name mismatches between the old and new surfaces; precedence alone is not
enough.

**How to apply:** when cutting a kind over to the unified plugin_configs tables,
(1) migrate rows, (2) retire/delegate the legacy routes, (3) drop the kind from
`LEGACY_OWNED_KINDS`. Also: PATCH on the unified router must hydrate the full
base+subsidiary envelope before merging the patch body, or partial updates drop
subsidiary fields / fail validation on required subsidiary columns.
