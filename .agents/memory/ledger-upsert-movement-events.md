---
name: Ledger upsert movement events
description: Durable requirements for conflict-updating ledger writes that can move an entry between workers or statement periods.
---

Stable-key ledger upserts must replace every mutable field, including transaction date and source references. If the EA or statement period changes, downstream mutation events must cover both the old and new coordinates and identify the operation as an update.

**Why:** Preserving row identity is not enough. A partial conflict-update leaves internally inconsistent ledger rows, while emitting only the new coordinate can leave derived state stale for the worker/month the entry moved away from.

**How to apply:** Any ledger bulk/upsert path must capture matching rows before the write, update the full mutable entry shape from `excluded`, and enqueue old plus new EA/statement coordinates only after commit.