---
name: Omada migration boundary
description: Records the operator-confirmed ownership boundary for Omada during S1 migration.
---

The S1 migration owns Omada's benefit catalog mapping, migrated policy assignment, elections, and worker-benefit history. It must not create or reconcile Omada linked-benefit eligibility rules; operators stand those rules up manually.

**Why:** The project owner explicitly confirmed that eligibility-rule configuration is not part of the migration process.

**How to apply:** Keep future S1 sync work limited to source-backed Omada data. Treat eligibility-rule setup and changes as manual operator configuration outside migration seeds and fleet reconciliation.