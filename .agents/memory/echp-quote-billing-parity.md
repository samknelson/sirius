---
name: ECHP quote/billing parity
description: ECHP eligibility quote and charge reconciliation must price from the same rule source
---

# ECHP quote must equal what is billed

The BAO ECHP feature has two pricing code paths that MUST agree: the
eligibility quote shown to the worker (server/modules/sitespecific/bao/echp.ts)
and the charge plugin's `computeExpectedEntry` reconciliation
(server/plugins/ledger/charge/plugins/sitespecific-bao-echp.ts).

**Rule:** both paths price from the SAME source — `loadEchpPricingRules()`,
which aggregates pricing rules across all enabled `sitespecific-bao-echp`
charge-plugin configs. When a policy matches several rules, every matching
price is shown and the LOWEST is billed (`resolveEchpQuote`).

**Why:** if reconciliation reads only the single executing config's
`settings.rules` while the quote aggregates across configs, a worker can be
quoted one price and billed another. Reading one shared source removes that
drift regardless of how many configs exist (the create route enforces one
global config per plugin/scope via a 409, so in practice there is exactly one).

**How to apply:** any future change to ECHP pricing must keep the quote and
`computeExpectedEntry` reading the same helper. Do not reintroduce per-config
or per-policy pricing that only one of the two paths sees.
