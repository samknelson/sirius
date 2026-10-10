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

Badge-source labels and navigation must reuse the existing quicksearch/Go
system, not a separate badge-specific record-linking framework.

**Why:** The owner explicitly asked to lean on the existing quicksearch/Go
framework when showing which note, skill, or other record generated a badge,
and does not want a big new framework.

**How to apply:** Keep badge displays as consumers of shared Go resolution;
scope any needed source-navigation support as a small extension of that system.

For note and skill sources with no standalone page, Go should open the parent
record's Notes or Skills tab and focus the matching source item.

**Why:** The owner explicitly selected this approach rather than leaving those
sources unlinked; it avoids creating standalone pages or parallel navigation.

**How to apply:** Extend existing Go resolution and the destination tab's
deep-link handling together, preserving the destination's access checks.

Each worker can have only one copy of a given badge, including when inactive or
revoked; this is not an active-only limit.

**Why:** The owner explicitly requires one copy per worker and badge type.

**How to apply:** Preserve that limit when designing future awarding and
reactivation rules rather than inserting additional copies for the same worker.

Note-derived badges use note-scoped ownership: a qualifying note grants the
badge if absent, its denorm status owns the awarded row, and deleting or
invalidating that status cascades to delete the badge. Another qualifying note
may re-grant through ordinary backfill; temporary absence until that happens is
acceptable. Do not retain revoked rows, aggregate notes, or build immediate
ownership handoffs for this rule.

**Why:** The owner explicitly corrected an overcomplicated lifecycle proposal:
the plugin should simply map note type X to badge type Y, with edits, deletion,
cleanup, and re-grant handled by the shared denorm framework.

**How to apply:** Keep the note plugin thin; wire missing shared framework
integration rather than adding custom per-plugin lifecycle management. Ensure
backfill can reconsider an already-processed qualifying note when the badge
owned by a different note disappears.
