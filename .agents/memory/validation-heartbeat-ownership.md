---
name: Validation heartbeat is not ownership
description: Why a stale upload-validation heartbeat cannot authorize another healthy run
---

A missing heartbeat is evidence of missing persisted progress, not proof that the validation process has stopped. Keep execution ownership separate from the heartbeat, and fence final results with the run identity.

**Why:** A blocked or failed progress write can leave a healthy validator running with an expired heartbeat. Admitting another run based on that timestamp alone duplicates work; reporting the first run as failed hides a persistence or browser problem.

**How to apply:** Preserve database-session exclusion across application processes, use a separate bounded pool for long-lived leases, and keep progress writes bounded and coalesced. Cancellation must happen in PostgreSQL, not by abandoning an uncancelled write after a JavaScript timeout. Browser polling failures, missing persisted heartbeats, and terminal server failures must remain different outcomes.
