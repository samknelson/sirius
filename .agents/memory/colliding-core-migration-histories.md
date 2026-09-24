---
name: Colliding core migration histories
description: Safely reconcile branch histories that reused the same high-water core migration versions.
---

**Rule:** A single high-water migration version cannot distinguish two branches that applied different work under the same version. Retain a single numbered lineage, move the other branch's still-relevant work above the current highest version, and ensure databases stamped by the other lineage replay the missing prerequisite work *before* the first downstream migration that depends on it. Replay must be idempotent on databases already on the retained lineage.

**Why:** The runner selects migrations strictly above the stored version. A database at the same stamp from the other branch silently skips all incoming migrations at or below that stamp; downstream DDL then assumes tables that do not exist. Duplicate version registrations also silently skip work.

**How to apply:** Check the current development version and both branches' migration bodies before choosing the bridge. Use a reliable branch-specific schema marker to replay work only on the lineage missing it; reject mixed/partial shapes explicitly. Prove replay safety against both branches' possible data, not just an empty local DB: `ADD COLUMN IF NOT EXISTS ... NOT NULL` fails on a populated table missing the column, and replaying a targeted DELETE can erase newly reintroduced configuration. Never infer idempotence from `IF NOT EXISTS` elsewhere in the same migration. Keep retired publish workarounds out of the active registry when their temporary tables no longer belong in the schema.