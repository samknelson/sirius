---
name: Charge plugin adjustment math (net-total reconcile)
description: How HOURS_SAVED/edit-driven charge plugins must compute adjustment deltas to stay idempotent.
---

# Charge plugin adjustments must reconcile against the net posted total

A charge plugin posts an immutable base ledger entry plus append-only
`hour_adjustment` delta entries; it never mutates the base entry's amount.
Therefore, when re-evaluating after an edit, the delta MUST be computed as
`expected - sum(all entries for this hoursId+configId)`, and the plugin must
no-op when that sum already equals `expected`.

**Why:** Comparing only the base entry's `amount` (which never changes) against
the expected amount is wrong: after one adjustment the base no longer reflects
the running balance. Editing hours 20→30→20 then leaves the net at price(30)
instead of price(20), overcharging the worker. The existing
`gbheHourlyCharge.ts` pattern (compare base-only) has this same latent bug.

**How to apply:** In `execute`, load `storage.ledger.entries.getByReferenceAndConfig(hoursId, configId)`,
sum amounts for the net total, and: if no charge expected → delete all those
entries (net back to 0); if none exist → create base; else post one correcting
adjustment for `expected - netTotal` (skip when |delta| < ~0.005). `verifyEntry`
already validates base+adjustments summed against expected, so this keeps
execution and verification consistent. See
`server/plugins/ledger/charge/plugins/sitespecific-bao-echp.ts`.
