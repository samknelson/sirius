---
name: Queue existence probes need an active-run index
description: A LIMIT 1 completion probe can be slower than COUNT without the supporting partial index.
---

Deploy queue completion existence probes together with the active-run partial
index; if removing the index, revert the probe first.

**Why:** Local PostgreSQL scale tests with terminal history ahead of active
rows chose a sequential scan for LIMIT 1 without the index, slower than the
old COUNT using a run-leading index. With the active-run index both populated
and empty probes were fast. A syntactically cheaper query is not proof of
less database work.

**How to apply:** Compare actual plans for both an active run and a fully
completed run before replacing counts with existence checks. Keep rollout
ordering explicit; local evidence does not establish a production cause.