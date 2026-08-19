---
name: S1 sync reconcile allowances
description: Full reconcile re-validates the whole population, so pre-existing data rejects recur every run; how to set stable allow-lists and vet them first.
---

# Full reconcile resurfaces pre-existing rejects

Converting a loader from "skip mapped rows" to full reconcile re-validates the ENTIRE staged population. Every historical data collision that create-time validation would catch now rejects on EVERY run, because rejected rows never advance their consumed fingerprint. Reject counts are therefore stable run-over-run unless the underlying S1 data is fixed — and a reason's count can legitimately shift shape once (e.g. a duplicate pair collapses into one duplicate + one ownership reject after the first run adopts one side).

**Why:** the first converted runs over dev surfaced stable reject sets that had nothing to do with the conversion itself; treating them as regressions wastes triage time, while blanket-allowing them without vetting can hide real fixture garbage.

**How to apply:**
- Per-environment allow-lists are part of a sync run's contract. Smokes hardcode the environment's list as documented consts and must assert their OWN fixture rows explicitly (by nid) so allowances can never mask fixture regressions. Unused allow entries are harmless — the gate only fails on disallowed reasons.
- **Vet before allowing:** check whether rejecting rows are orphaned probe fixtures in the fake-nid range (99900xxx+) rather than real population data; query the staged rows behind each reject class first and remove orphaned fixtures instead of allowing their reasons.
- Expect the same triage exercise on each new environment (rehearsal/prod): same mechanism, different counts.
