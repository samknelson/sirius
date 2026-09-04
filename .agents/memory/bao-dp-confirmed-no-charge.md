---
name: BAO DP confirmed no-charge vs provisional rates
description: How a $0.00 DP rate is interpreted by billing and the payment eligibility gate, and why the two share one pricing module.
---
Rule: a DP rate row that is **non-provisional and exactly $0.00** means "covered at no charge" — billing posts nothing (and zeroes any prior net for that month), the DP payment gate grants coverage without a payment. A **provisional** row (any amount) or a missing/ambiguous rate is a missing rate: billing skips, the gate fails closed.

**Why:** the 2026 rate sheet confirms family→family-with-DP as no charge, and the stored `rate` is the monthly MEMBER CHARGE (collected 48% tax), never the imputed-income column. Before this, `rate <= 0` was lumped with "missing" and storage forced family rows provisional, so a confirmed free month could never exist.

**How to apply:** both the charge plugin and the eligibility plugin price through `server/modules/sitespecific/bao/dp-pricing.ts` (tier from non-DP covered lives, single rated medical benefit). Never re-add a per-transition "must stay provisional" rule; never treat provisional $0 as free; never present imputed income as an amount owed. The 2026 values live in `dp-rates-2026.ts` (seed script is a thin wrapper) so tests prove the numbers and idempotency.
