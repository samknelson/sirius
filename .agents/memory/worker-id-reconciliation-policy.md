---
name: Worker identifier reconciliation policy
description: Approved destructive duplicate cleanup and authoritative T631 EIN reconciliation.
---
The user explicitly chose automatic, non-interactive destructive deduplication before enforcing one worker ID per worker/type. Retain one deterministic arbitrary row and delete extras; no manual pre-deployment cleanup prerequisite.

**Why:** The user accepts potentially retaining the wrong identifier during upgrade, expecting subsequent sync to correct it. This authorization covers duplicate cleanup, not reassignment between workers.

**How to apply:** Perform cleanup and uniqueness enforcement transactionally. Every successfully matched T631 worker sync must retain only the authoritative incoming Freeman EIN, deleting nonmatching Freeman EIN rows and creating the matching row if absent. Other types are not guaranteed to be restored by T631.

An EIN match may fill a missing T631 ID, but must never replace an existing different T631 ID or transfer IDs between workers. Numeric and uppercase-I-prefixed T631 IDs are lookup aliases; preserve an existing stored spelling.

**Why:** The user approved linking workers imported with only their Freeman EIN, not merging identities or broad identifier normalization.

**How to apply:** Check both T631 forms for ambiguity first; only attach the incoming ID when neither form is owned and the EIN owner has no T631 ID.
