---
name: Freeman migration count semantics
description: Owner-defined meaning of created and updated counts in Freeman migration summaries.
---

In Freeman migration summaries, a source crew, assignment, or worker that matches an existing local record counts as **updated**, even when none of its field values changed. A source record with no match counts as **created**.

**Why:** The owner explicitly chose match-based reporting over change-only reporting so the one-time migration summary explains reconciliation outcomes rather than field-level diffs.

**How to apply:** Preserve these labels anywhere Freeman migration child-record counts are calculated, displayed, exported, or persisted. Do not reinterpret “updated” as “values changed.”