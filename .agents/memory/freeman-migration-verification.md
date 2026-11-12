---
name: One-time Freeman migration verification
description: Project decision on how to verify temporary Freeman migration functionality.
---

Do not add or retain automated tests specifically for Freeman migration functionality.

**Why:** The migration is a one-time cutover tool that will be removed after the data move. The owner explicitly chose not to carry permanent unit or UI tests for functionality that will never run again.

**How to apply:** For Freeman migration changes, use type checking, architecture lint, production compilation, independent code review, startup/log inspection, and authenticated manual verification where available. Do not propose missing Freeman migration tests as follow-up work.