---
name: Worker identifier reconciliation policy
description: Approved destructive duplicate cleanup and authoritative T631 EIN reconciliation.
---
The user explicitly chose automatic, non-interactive destructive deduplication before enforcing one worker ID per worker/type. Retain one deterministic arbitrary row and delete extras; no manual pre-deployment cleanup prerequisite.

**Why:** The user accepts potentially retaining the wrong identifier during upgrade, expecting subsequent sync to correct it. This authorization covers duplicate cleanup, not reassignment between workers.

**How to apply:** Perform cleanup and uniqueness enforcement transactionally. Every successfully matched T631 worker sync must retain only the authoritative incoming Freeman EIN, deleting nonmatching Freeman EIN rows and creating the matching row if absent. Other types are not guaranteed to be restored by T631.
