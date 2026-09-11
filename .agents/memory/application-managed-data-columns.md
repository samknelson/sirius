---
name: Application-managed data columns
description: Defines how generic data columns should be treated by core user-facing forms.
---

Generic `data` columns are application-managed extension space for site-specific functionality and features that do not belong in the core database structure. Core forms must not expose them as raw JSON or make them directly user-editable, and ordinary form updates must omit them so existing application-managed values are preserved.

**Why:** Raw extension data is an internal application contract, not a general user-facing field. Exposing it couples administrators to implementation details and lets unrelated edits accidentally replace feature-owned state.

**How to apply:** When building or changing a core form for a record with a generic `data` column, leave that property out of form state and ordinary update payloads. Feature-specific code may continue to read or write the column through its owned interface.