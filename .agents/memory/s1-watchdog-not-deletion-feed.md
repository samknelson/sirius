---
name: S1 watchdog is not a deletion feed
description: Why Drupal S1 watchdog cannot serve as the migration's authoritative daily deletion cursor.
---

Do not use S1's Drupal `watchdog`/dblog table as the authoritative deletion feed for daily migration syncs.

**Why:** The production check on 2026-08-21 showed only about 44 minutes of retained events, consistent with the configured roughly-1,000-row dblog limit. Its deletion-like records had neither node links nor NID-bearing variables. The schema has no general audit/tombstone table; `feeds_log`, normal field revision tables, and the workflow-specific `sirius_trust_wb_scan_changelog` are not universal entity-deletion journals.

**How to apply:** A holistic incremental daily sync needs a durable, identity-bearing source change journal/tombstone mechanism covering every migrated node and raw-table entity. Until one exists and is validated across write paths, use changed-row extraction plus periodic key-only/full reconciliation sweeps to discover hard deletes.