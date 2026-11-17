---
name: Mandatory cron non-overlap
description: User's scope rule for cron execution locking and distinction from scheduler election.
---

All cron jobs must have non-overlap locking, not an opt-in per-plugin capability. Apply the same boundary to scheduled and manual execution.

**Why:** The user explicitly stated there is no situation where two processes should both run the same cron job, rejecting the proposed optional-locking approach.

**How to apply:** Preserve job-specific fencing alongside generic execution locks. Distinguish coordinated starts from guaranteed exclusion of side effects after connection loss. On 2026-11-17 the user requested a plan to replace reserved connections with table-backed leases named `semaphores`; this is a proposed direction, not implementation approval. Its timeout takeover must explicitly acknowledge that a stalled heartbeat does not prove the old executor stopped.

Abandoned-history recovery requires running-history admission to share the execution lock, not just the plugin invocation.

**Why:** A contender can wait before lock acquisition and execute later. If it already has a running row, another owner cannot distinguish that contender from an abandoned executor. Clock ordering does not fix this.

**How to apply:** Keep running admissions and recovery on the owning session; contenders that lose never publish running history. Recovery reports uncertain partial work, never proves JavaScript stopped or replays it.
