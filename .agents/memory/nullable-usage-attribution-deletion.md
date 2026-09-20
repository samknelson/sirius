---
name: Nullable usage attribution deletion
description: Count-conservation rules when an optional configuration FK participates in a NULLS-NOT-DISTINCT counter key.
---

A counter keyed by a nullable configuration with `NULLS NOT DISTINCT` cannot rely on plain `ON DELETE SET NULL`. Before deleting a configuration, merge its attributed rows into the existing null bucket. When recording, resolve and key-share-lock the configuration inside the upsert statement; if deletion already won, write the count to null.

**Why:** A delete can collide with an existing null row, and a call that resolved before deletion can finish afterward. Without both protections, configuration deletion either fails uniqueness or the late paid call fails its FK and is omitted.

**How to apply:** Use this pattern whenever a nullable FK is part of an aggregate counter's uniqueness tuple and deletion is meant to preserve totals as unattributed history.