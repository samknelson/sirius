---
name: Detached shell processes are reaped
description: nohup/setsid backgrounding from agent shell sessions dies with the session; long dev runs need a temp managed workflow; smokes with delete-then-restore fixtures need crash repair.
---

**Rule:** Processes backgrounded from an agent shell command (`nohup`, `setsid`, `&`) do NOT survive the shell session — they are killed around the time the launching command exits or times out, even in a new session. For anything longer than the ~5-min shell cap (wet benches, multi-run smokes), configure a TEMPORARY managed console workflow (`configureWorkflow` + `autoStart`, command tees to a /tmp log), poll the log file, then `removeWorkflow`. Foreground shell is fine for runs comfortably under the cap.

**Why:** A backgrounded `smoke-money-sync --phase hours` was killed mid-block after its launcher timed out — AFTER the block deleted a staged payperiod record but BEFORE the finally-restore ran, corrupting shared dev staging.

**How to apply:**
- Never background a smoke/bench that mutates shared dev state; run it foreground (if it fits) or as a temp workflow.
- If such a smoke dies mid-block anyway: the lost staged record is findable as an ORPHAN — a `worker_hours` day=1 row + `s1_staging.hours_keys` key whose (worker, employer, month) has no staged payperiod group (join back through id_map). Reconstruct from a sibling record of the same worker+employer (loader consumes only worker/shop nids, date_start month, and json totals hours/by_type; title/changed/extra fields are cosmetic), using any unused nid below the bench ranges (90M+).
- Bench/smoke fixture nid ranges: trackc-bench owns 90M+, t20-write-bench owns 96M+.
