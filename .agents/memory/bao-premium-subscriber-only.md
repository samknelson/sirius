---
name: BAO premium subscriber-only charges
description: Premium charges bill subscribers only; settled (swept) months must never be re-billed.
---

BAO premium charges are keyed to subscribers only; dependent WMB events retarget to the relation's subscriber, and the billed tier comes from live WMB rows, not the trust election.

**Why:** dependents now get their own WMB rows; charging each row double-billed providers, and elected coverage can disagree with actual coverage.

**How to apply:**
- Any premium recompute path must check whether the coverage month was already swept into a premium file before writing a replacement charge — a settled charge+payment pair nets to zero, so a "replacement" entry is an additional unpaid group and bills the month twice. Skip and flag for manual review instead.
- Orphan state (dependents covered, subscriber has no own row) still bills the subscriber and must be flagged, never silent.
