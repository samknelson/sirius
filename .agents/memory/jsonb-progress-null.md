---
name: JSON null in wizard progress
description: Cleared progress must remain an object when the next run is admitted.
---

Treat JSON null separately from SQL NULL before merging progress objects.

**Why:** Parameters intentionally clears progress to JSON null. PostgreSQL
COALESCE does not replace that value, and JSON null concatenated with an object
creates an array. Admission then appears successful while ownership checks and
browser polling cannot find status or runId.

**How to apply:** Normalize JSON null at the storage merge boundary. Verify
save → start → fenced write → completion against PostgreSQL, not only JavaScript
object-spread mocks. Do not equate unreadable progress with a stopped run.
