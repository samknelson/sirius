---
name: Oneoff confirmation and cancellation races
description: Safety boundaries for administrator-triggered destructive and cancellable operations.
---

An administrator's destructive approval is for the state they previewed, not just the action and input. Invalidate older approvals whenever another preflight for the same plugin begins, even if the visible row count later returns to the same value. Compare persisted JSONB inputs canonically; PostgreSQL changes object key order. Acknowledged cancellation must compete atomically with terminal success or failure rather than relying on a prior read.

**Why:** A table can be dropped and recreated with different rows but the same count, so a count-only confirmation can delete unapproved data. A cancellation between the final read and write can otherwise leave an acknowledged request marked successful. JSONB key reordering can incorrectly reject valid tokens.

**How to apply:** On new Oneoff actions or configuration paths, retain plugin-wide serialization of approvals and work; make terminal transitions conditional on the current cancellation state at the database write boundary. Do not compare raw JSON stringification of database-retrieved and request objects.

Fresh confirmation expiry must compare the naive database timestamp to the database's session-local clock, not to a JS `Date`. **Why:** Drizzle can expose a local wall-clock `started_at` as UTC, making a new approval appear hours old. **How to apply:** Keep the ten-minute cutoff in the approval query, under the same database session zone that writes the timestamp; do not weaken token identity or single-use checks to compensate.