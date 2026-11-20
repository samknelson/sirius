---
name: Coverage span direction
description: User's preferred direction for repeated carrier history reconstruction.
---

The user prefers a maintained `denorm_span` table over reconstructing coverage
history on every carrier feed check. Their supplied design uses one row per
continuous worker/benefit/source/COBRA-class segment, not per month or carrier.
Gaps, source changes and COBRA changes split segments; ordinary employer
changes do not. Segment IDs are derived and need not survive rebuilds.

Last-covered month is not termination. Termination month needs authoritative
evidence; uninterrupted COBRA/non-COBRA switches do not terminate the benefit.
The user also requires a `termination_reason`.

Keep conflict facts in a companion issue table at person/benefit/month grain,
with source record references. Exclude all competing candidates and dependents
that cannot stand without an excluded subscriber, not the person's whole
history. Eligibility plugins remain authoritative.

Use existing denorm stale-work tracking, not a per-segment current flag.
An empty table during backfill must never mean everyone lost coverage.

**Why:** Repeated staging failures exposed expensive continuation-scan history
reads even after switching start-date lookup to lifecycle events.

**How to apply:** Implement the span framework and benefit-owned derivation
before replacing the feed's repeated history reconstruction. The supplied
design describes benefit-specific facts; generic framework storage details
still need alignment with the existing denorm framework.
