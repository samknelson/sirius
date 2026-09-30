---
name: Monthly coverage history design direction
description: The user's chosen exploration direction for grouping worker monthly coverage history
---

Prefer a compact chronological accordion of consecutive coverage months grouped by the same recorded status, with explicit inclusive start and through months and a duration. Keep unconfirmed decisions distinct from inactive periods. When a long period opens, let the worker select a month to see its existing benefit and work-month evidence rather than expanding every full card at once.

**Why:** The user chose the status-run approach over timeline and interruption-first alternatives, then explicitly asked to build it in the app.

**How to apply:** Keep this direction in subsequent monthly coverage-history changes; preserve the work-month → coverage-month mapping and handle incomplete pagination boundaries honestly.

When the sole recorded failed cause is no election, call that span **Unenrolled**, not Inactive. Keep other failed causes (including mixed no-election and ineligibility causes) **Inactive**, with their recorded reasons visible. Never infer no election from absent benefits or hours.

**Why:** The user explicitly asked to distinguish a person who did not elect coverage from someone whose eligibility scan found them inactive.

**How to apply:** Preserve this distinction in the UI and derive it only from trustworthy recorded election outcomes; a mixed no-election and ineligibility failure is not "just no election."