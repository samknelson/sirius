---
name: Disability Credit coverage-axis month model
description: Why DC months are chosen/validated as coverage months while the stored key stays the work month, and the invariants the picker/validator/approve share.
---

**Rule:** Staff pick Disability Credit months on the COVERAGE axis (the month the
Fund thinks in); the case row, API key and every event keep the WORK month
(coverage − plan lag). The client only ever submits the option's work-month key;
the server re-derives coverage from the worker's own eligibility rules. No schema
change was needed for this and none should be introduced for it.

**Why:** the Fund spec's canonical case (covered through Sep, approve Oct+Nov
coverage → hours land Jul+Aug) was refused as "already covered" when the covered
set unioned WMB months with any work month having hours > 0 — the two axes were
being compared as one. Partial-hours work months (the top-off case) were
unselectable for the same reason.

**How to apply:**
- "Covered" = WMB coverage months ∪ coverage months whose work month already meets
  the plan minimum. Never reintroduce "hours > 0 ⇒ covered".
- Picker, validator and approve must all read lag/minimum from ONE per-request
  month map built on the grant service's requirement resolver over a shared
  per-worker resolution context (worker/election/policy/WMB resolved once per
  request, not once per month); a resolver failure is a per-month "unavailable"
  reason, never a thrown error.
- A worker with no established coverage resolves NO months, so the pure validator
  never sees a ref — the map-level validator has to append NO_PRIOR_COVERAGE
  itself.
- At-or-above-minimum months are offered as not_grantable (visible, explained),
  not hidden; a selected month that drifts to no-shortfall is voided at approval
  with an explicit "no annual month consumed" warning.
- Annual capacity keeps counting by the WORK month's calendar year (spec/out of
  scope to change); "maxed out" is derived from the same year-usage as the
  dashboard's Annual Maximum Reached list.
- The case log is the spec's immutable record: every selection/deselection/
  grant event stamps the coverage month AS VALIDATED at write time, and the
  history view renders each entry's own snapshot (live lag only for entries that
  predate snapshots, and it says so). A later plan-lag change must never move a
  historical entry.
