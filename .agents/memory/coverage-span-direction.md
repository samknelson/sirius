---
name: Coverage span direction
description: User's preferred direction for repeated carrier history reconstruction.
---

The user prefers a maintained `denorm_span` table over reconstructing coverage
history on every carrier feed check. The detailed framework contract still
needs to be recovered from the prior discussion before implementation.

**Why:** Repeated staging failures exposed expensive continuation-scan history
reads even after switching start-date lookup to lifecycle events.

**How to apply:** Align on the span framework before further query-by-query
optimization. Eligibility plugins remain the authority for coverage; a derived
span must not become a separate eligibility rule.
