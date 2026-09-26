---
name: Maintenance-aware startup reconciliation
description: How boot-time registration and database reconciliation must be separated when maintenance is already active.
---

Boot initialization must keep framework, plugin, provider, listener, route, and other in-memory registration unconditional. Put only named, idempotent database-mutating reconciliation behind the maintenance-aware startup boundary.

**Why:** A database can already be in maintenance when a process starts. The connection-level write lock must remain strict, but the process still needs enough registration and authentication setup for an existing administrator to sign in and leave maintenance. Catching generic read-only failures hides real initialization defects and can leave an unsafe half-boot.

**How to apply:** When adding boot work, split registration from seeds, legacy migrations, backfills, singleton creation, and self-healing writes. Declare each mutating phase by name, let failures remain fatal on a normal boot, and make the phase idempotent so a maintenance-exit retry or the next normal boot can complete it.