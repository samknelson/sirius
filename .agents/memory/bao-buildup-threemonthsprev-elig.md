---
name: BAO buildup threemonthsprevElig quirk
description: Why the BAO threshold plugin derives eligibility from hours>=threshold instead of buildup's threemonthsprevElig flag.
---

The BAO Threshold eligibility plugin delegates to `fetchBuildupStatus`
(buildup helper) with `lagMonths: 3`: the threshold rule's single examined
month equals buildup's "benefit month", and buildup already resolves the
threshold and loads monthly hours. Threshold-resolution/look-back/hours logic
must stay only in buildup.

**Gotcha:** `BuildupStatus.threemonthsprevElig` is NOT a faithful
`benefitMonthHours >= threshold` in every case. When the worker has no hours at
or before the benefit month, `fetchBuildupStatus` returns early with
`threemonthsprevElig = false` regardless of threshold. For a degenerate
threshold of 0 the legacy threshold rule returned eligible (0 >= 0), so trusting
the flag silently changes behavior.

**Why:** It's a real behavioral divergence caught only in code review, not by the
happy-path verify script (`scripts/oneoffs/verify-bao-threshold.ts` uses
threshold 100).

**How to apply:** Derive threshold-plugin `success` as
`hours >= effectiveThreshold`, taking `hours` from the benefit-month entry in
`buildup.monthDetails` (absent → 0) and `effectiveThreshold` from
`buildup.threshold`. Identical to `threemonthsprevElig` for every threshold > 0,
faithful in the zero-threshold/no-hours corner.
