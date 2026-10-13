---
name: Component commit coherency
description: Why same-value component saves must invalidate dependent state across processes
---

Observe committed component saves, not just changes to boolean flag values.

**Why:** Re-enabling or repairing an already-enabled component can materialize or reactivate its owned plugin configurations while its flag remains `true`. A boolean-only comparison leaves other processes serving old configuration slices even though their component switches look correct.

**How to apply:** A cross-process refresh must detect these same-value commits and invalidate dependent caches. Ordinary unchanged reads must not bump the cache revision. Failed reads represent unknown state: fail closed, do not interpret them as disabled flags or substitute defaults.
