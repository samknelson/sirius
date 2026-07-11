---
name: Wizard benefit filtering choke point
description: Where to filter/gate which benefits an enrollment wizard offers, and which wizards it affects.
---

`server/plugins/wizards/enrollment/foundation.ts` → `evaluateEligibleBenefits`
is the single source of truth for which benefits an enrollment wizard offers.
Both the Benefits step `getData` (display) AND `submitBenefits` (server-side
re-validation) call it, so filtering there covers offer + accept in one place.
It is shared by First-time Enrollment and Open Enrollment.

**Why:** any per-benefit / per-type gating (e.g. the "Show on enrollment
wizards" benefit-type toggle) belongs here so the offered list and the submit
guard can never diverge.

**How to apply:** the Life Event wizard does NOT use this function — it seeds
`benefitIds` from the active election view and has no benefits step, so it
carries benefits forward unchanged. Never route carry-forward through this
filter or you'll strip an existing election's benefit when its type is later
hidden.

Note: `storage.trustBenefits.getAllTrustBenefits()` strips the raw
`benefitTypeData` jsonb and only re-surfaces specific extracted fields
(e.g. `benefitTypeIcon`, `benefitTypeShowOnEnrollmentWizards`). To read a new
benefit-type `data` flag downstream, add an extraction there — don't expect the
raw blob.
