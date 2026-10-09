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

## Stored coverage is not source-history completeness

The user explicitly permits importer-reviewed rejects for historical event
reconciliation. Require the pinned horizon, completed staging, full span
traversal, zero verification failures and successful importer/fleet/parity gates.
Keep source completeness false when source spans were rejected. Successful
event traversal describes stored S2 coverage, not complete S1 history.

**Why:** reviewed rejection policy is importer-owned; the historical phase
must not independently reinstate a blanket zero-reject rule. Missing months
can still reflect rejected or stale retained histories, so reports must not
claim those histories are complete or harmless.

**How to apply:** keep historical event reconciliation separate from coverage
loading and refuse invalid cutoff/traversal evidence. Do not widen the importer's
allowlist or add per-history exclusions. Remote rollout requires actual remote
fleet and pinned-image proof; fixture tests are not deployment
evidence.