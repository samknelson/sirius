---
name: Wizard step advancement must use dispatcher navigate
description: Programmatic wizard launches must advance steps via /dispatch/navigate, never by PATCHing currentStep.
---
Rule: after completing a step programmatically (e.g. pre-selecting a config from a dashboard "new wizard" action), advance with `POST /api/wizards/:id/dispatch/navigate {direction:"next"}` — do NOT `PATCH /api/wizards/:id {currentStep}`.

**Why:** only the navigate route stamps the next non-run step's progress `in_progress`; a bare currentStep PATCH leaves the new current step `pending`, so the generic wizard UI can't treat it as active (code review rejected exactly this).

**How to apply:** any server- or client-side wizard launcher that skips ahead of step 1: create → step submit → navigate next → redirect to /wizards/:id. Never preset progress on `run` steps.
