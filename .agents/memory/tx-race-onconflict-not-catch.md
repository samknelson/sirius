---
name: Transaction race handling via ON CONFLICT
description: Why concurrent-insert races inside a Postgres transaction must use ON CONFLICT DO NOTHING instead of try/catch.
---
Rule: when two transactions may race to insert the same unique-keyed row (e.g. a link row keyed by a unique job_id) and both should "succeed", do NOT catch the unique-violation error inside the transaction — after any statement error Postgres marks the tx aborted, so continuing (or committing) fails anyway. Instead: `.onConflictDoNothing({ target })` + `.returning()`; if zero rows came back, the other tx won — delete any side-effect rows this tx created earlier (e.g. the event row inserted just before the link) and return success.
**Why:** discovered via architect review of the bullpen job→event sync; a documented "treated as already synced" comment did not match behavior, and the naive catch fix would have produced "current transaction is aborted" errors.
**How to apply:** any upsert-style storage method that inserts a parent/side-effect row then a unique link row inside runInTransaction.
