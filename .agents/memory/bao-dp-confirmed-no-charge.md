---
name: BAO DP confirmed no-charge vs provisional rates
description: Business rule for how a $0.00 DP rate is interpreted by billing and the payment eligibility gate.
---
Rule: a DP rate that is **non-provisional and exactly $0.00** means "covered at no charge" — nothing is billed and the DP payment gate grants coverage with no charge, no billing account and no payment. A **provisional** rate (any amount) or a missing/ambiguous rate is a missing rate: nothing is billed and the gate fails closed.

**Why:** the Fund's 2026 sheet confirms family→family-with-DP as no charge, and the stored rate is the monthly MEMBER CHARGE (the collected 48% tax), never the imputed-income column. Earlier code lumped `rate <= 0` with "missing" and forced family rows provisional, so a confirmed free month could not exist.

**How to apply:** billing and eligibility must price through the one shared DP pricing rule; never re-add a per-transition "must stay provisional" rule, never treat provisional $0 as free, never present imputed income as an amount owed, and decide no-charge BEFORE any account/charge/payment check.
