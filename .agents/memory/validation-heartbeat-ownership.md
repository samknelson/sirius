---
name: Validation heartbeat is not ownership
description: Why an upload heartbeat is not ownership or permission to retry side effects
---

A missing heartbeat is evidence of missing persisted progress, not proof that the validation process has stopped. Keep execution ownership separate from the heartbeat, and fence final results with the run identity.

**Why:** A blocked or failed progress write can leave a healthy validator running with an expired heartbeat. Admitting another run based on that timestamp alone duplicates work; reporting the first run as failed hides a persistence or browser problem.

**How to apply:** Preserve database-session exclusion across application processes, use a separate bounded pool for long-lived leases, and keep progress writes bounded and coalesced. Cancellation must happen in PostgreSQL, not by abandoning an uncancelled write after a JavaScript timeout. Browser polling failures, missing persisted heartbeats, and terminal server failures must remain different outcomes.

Side-effecting upload Process is not harmless validation. A lost executor or
unconfirmed terminal save cannot authorize another upload or repetition of
business writes, even in a new wizard for the same employer/month.

**Why:** Hours, withholding allocations and charges are posted incrementally.
A healthy executor can outlive its persisted heartbeat, and interrupted work
can leave real partial postings. A new wizard can interact with those postings.

**How to apply:** Retry only terminal metadata persistence, never processing
side effects. Require an isolated test employer/period or explicit
reconciliation approval before testing another upload against the same period.
Keep stale-heartbeat warnings separate from confirmed execution failures, and
never describe a stale heartbeat as proof that work stopped.

Retain side-effecting BAO Process wizard records and their attachments after
admission, including completion and unconfirmed outcomes.

**Why:** Deleting the parent while business writes continue destroys tracking
and reconciliation evidence and prevents the owning run from saving results.

**How to apply:** Enforce refusal at the atomic deletion transition, before file
cleanup, and at the final parent delete. A UI-only guard or a pre-delete read
cannot protect against a concurrent Process admission.
The stored wizard type must also be immutable after admission, or a type-only
edit can reclassify the record and bypass type-scoped retention.
