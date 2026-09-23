---
name: WMB inferred event ownership
description: How historical coverage-gap terminations coexist with scan-confirmed lifecycle events.
---

Coverage gaps establish an ending month but do not establish eligibility
failure. Historical termination inference must use explicit provenance and
never claim failed eligibility plugins. A scan-confirmed event wins if both
sources name the same worker/benefit/month.

**Why:** scan denorm reconciliation used to replace the entire termination
slice. Without ownership-aware deletion, any later scan recompute erases
historical inferred endings; without scan precedence, a backfill can turn a
real failed eligibility decision into a mere coverage gap and mislead COBRA.

**How to apply:** preserve inferred terminations during scan replacement except
when a confirmed scan writes the same key; historical reconciliation may
delete only provenance-marked inferred terminations. Downstream consumers
requiring a failed eligibility decision must explicitly exclude inference,
while general historical reporting may still include it.