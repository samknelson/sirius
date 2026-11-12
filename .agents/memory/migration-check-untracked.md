---
name: Migration inventory during local renames
description: Distinguish the live local inventory from deployed migration history.
---

Local migration validation must include untracked replacements and exclude
deleted tracked paths, for both core and component migrations. The deployment
branch inventory must remain intact even if those paths no longer exist locally.

**Why:** Git can report the committed pre-rename path as newly added against a
deployment branch while the working tree already contains its replacement.
Counting both produces a false collision. Filtering deployment history instead
would hide a real high-water mark and permit a migration that never executes.

**How to apply:** treat rename destinations as additions regardless of Git's
similarity classification. Renumbering must also update source-level migration
rehearsal readers, not just registry imports.
