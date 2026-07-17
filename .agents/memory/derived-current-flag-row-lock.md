---
name: Derived "current" flag needs parent-row lock
description: Recomputing a derived is_current/latest flag under a partial unique index requires serializing per-parent via SELECT ... FOR UPDATE on the parent row.
---

Rule: when a child-history table derives a single "current" row per parent
(enforced by a partial unique index) and every mutation clears-then-sets the
flag inside a transaction, two concurrent transactions on the same parent can
interleave (each misses the other's uncommitted flag) and trip the unique
index.

**Why:** the clear step only sees committed rows; the partial unique index
fires at the second transaction's set step.

**How to apply:** take `SELECT id FROM <parent> WHERE id=$1 FOR UPDATE` as the
FIRST statement of each mutation transaction so per-parent mutations
serialize. Also map the resulting 23505 by `error.constraint` name so a
"duplicate date"-style message isn't shown for the concurrency-race index.
