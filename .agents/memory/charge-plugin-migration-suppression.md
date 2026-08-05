---
name: Charge-plugin migration suppression
description: Bulk loads must run charge-suppressed; notification suppression alone does not stop charges
---

Rule: bulk/migration loaders writing core rows through storage must run in the ambient charge-plugin-suppressed scope (request-context ALS, same pattern as notification suppression) — suppressing notifications alone does NOT stop charge plugins. Preflights that check charge-plugin state must import through the charge package barrel; importing internal modules directly leaves the plugin registry empty and the check vacuously passes.

**Why:** worker_hours-style writes fire charge plugins per row; during a migration, ledger history arrives via its own loader, so replay double-bills. An empty-registry preflight once made the safety check ineffective.

**How to apply:** production bulk loads must opt into migration mode explicitly; without it a loader should abort before writing if any charge plugin is runnable (component enabled + enabled config). The flag is loader/operator-only — deliberately no HTTP header.
