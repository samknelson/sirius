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

## Import completeness is stronger than importer success

Do not authorize inferred endings from a green importer exit alone: even
ruled/allowed rejects can omit history or retain stale desired spans. Require
the actual pinned horizon, complete source staging, full span traversal and
zero unresolved coverage rejects/verification failures. A hypothetical dry
import cannot prove stored history.

**Why:** a missing month may represent an unresolved source span rather than
a termination; treating allowance policy as completeness creates false
historical endings.

**How to apply:** keep historical event reconciliation separate from coverage
loading and independently refuse unsafe cutoff evidence. Production activation
requires actual remote fleet and image proof; fixture tests are not deployment
evidence.