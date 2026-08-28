---
name: Durable denorm handoff & scan repro traps
description: Event-driven denorm updates must be durably enqueued in the producer's commit; dev DB may lack eligibility rules so scans pass everything
---

**Rule.** Derived data maintained by a fire-and-forget event handler must be durably enqueued in the SAME transaction as the producing commit: mark the denorm row `stale` inside the producer's transaction (and in the registry handler before compute), so a missing/disabled/failed handler leaves a visible stale row the hourly stale-recompute cron heals — and a crash can never commit the producing result without the handoff.

**Why:** WMB terminate events were silently lost forever when the completion-event handler skipped or failed: nothing marked the row stale, the backfill sweep only finds entities with NO denorm row, and skips were console-log-only (invisible in the admin log viewer). A post-commit stale mark was rejected in review as non-atomic.

**How to apply:** Resolve the stale seed before the producing commit and persist it inside that transaction; treat "no denorm config" as an operator alert (storageLogger — safety net unarmed) and "config disabled" as paused-not-lost (row stays queued stale; both handler and sweep skip until re-enabled).

**Repro trap:** a dev DB can have zero trust-eligibility rule configs — every benefits scan then passes everything (`pluginResults: []`), making scan-failure bugs unreproducible until rules are seeded. Real-DB queue tests can use a unique `triggerSource` so claims never touch real jobs, plus a canned-scan seam instead of policy/rule fixtures.
