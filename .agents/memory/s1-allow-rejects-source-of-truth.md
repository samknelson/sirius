---
name: S1 production allow-rejects source of truth
description: Where "Acceptable as-is" reject rulings actually live and what mirrors what.
---

The rehearsal reject-triage workbook was generated but never filled in (every row "Not reviewed") — it is NOT the decision record.

**Rule:** reject-class rulings live in RUNBOOK §5; the executable production allow-lists live in the sync config's production profile. Any ruling change (new allowance, retirement, pending-ruling removal) must update both in the same change. Conditional "verify then allow" classes stay OUT of the standing config — they are per-run operator allowances.

**Why:** the two drifted apart silently; §5-ruled classes missing from the profile would abort the production run at the reject gate, while a rehearsal-only allowance left standing (pending a fund ruling) would let unresolved coverage decisions pass silently.

**How to apply:** before any production run, mechanically diff the profile's per-step allowRejects against the §5 rulings and summary table; treat any mismatch as a triage item, not a formatting nit.
