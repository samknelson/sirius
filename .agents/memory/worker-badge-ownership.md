---
name: Worker badge ownership
description: Worker badges are awarded from system activity and maintained only by denorm plugins, not assigned manually.
---

Worker badges must be awarded as a result of other system activity. Only denorm
plugins populate and maintain the awarded-badge rows; no UX may write directly
to those rows, including manual grants, revocations, or edits to their dates.

**Why:** The owner explicitly wants activity-derived awards rather than badges
assigned directly.

**How to apply:** Keep badge-type configuration editable through unified
options, but do not confuse defining a badge type with assigning a badge to a
worker. Future award rules and any badge-display UX must preserve plugin-only
ownership of the derived rows.
