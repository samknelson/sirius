---
name: Appeal benefit inventory format
description: How to present full T16 appeal benefit triage without adding loader output.
---

For T16 appeal-benefit unmapped investigations, give the operator a read-only
query over staged appeal policy titles, staged benefit titles/NIDs, and the
benefit ID map. Do not add a complete grouped breakdown to the loader report.

**Why:** The user explicitly preferred running a staging query over expanding
the loader's reporting surface. The existing reject samples are capped and
cannot establish the full distribution.

**How to apply:** Keep the loader's per-row reject and aggregate gate intact.
Use an operator-side query to establish all candidate kinds/titles and mappings
before changing exact aliases; distinguish pre-filter appeal totals from actual
reject counts, since worker and date checks run before benefit resolution.