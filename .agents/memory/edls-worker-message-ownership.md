---
name: EDLS worker message ownership
description: User-selected distinction between editable assignment-update and removal SMS messages.
---

EDLS worker assignment-update and removal SMS wording must be separately editable through Template Studio. Removal messages link to the worker's current schedule without asking them to accept or decline an assignment they no longer have.

**Why:** The user explicitly selected a separate editable removal template when requesting Template Studio support for this notifier; retaining code-only removal text or applying the assignment-update wording to removals does not satisfy that choice.

**How to apply:** Preserve both message cases when implementing template defaults, configuration editing, previews, or future message migrations.

Workers sometimes confuse which work date an EDLS notification refers to.

**Why:** The user reported this as a worker comprehension problem, not merely a formatting preference.

**How to apply:** Preserve prominent, separated assignment-date headings when changing notification layout, including messages containing multiple assignments.
