---
name: Mandatory cron non-overlap
description: User's scope rule for cron execution locking and distinction from scheduler election.
---

All cron jobs must have non-overlap locking, not an opt-in per-plugin capability. Apply the same boundary to scheduled and manual execution.

**Why:** The user explicitly stated there is no situation where two processes should both run the same cron job, rejecting the proposed optional-locking approach.

**How to apply:** Preserve job-specific fencing alongside generic execution locks. Periodic connection checks must not turn into heartbeat-expiry lock stealing: a stalled heartbeat does not prove the old executor stopped. Distinguish coordinated starts from guaranteed exclusion of side effects after connection loss.
