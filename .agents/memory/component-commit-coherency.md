---
name: Component state coherency
description: Cross-process component commits and independent storage diagnostic status
---

Observe committed component saves, not just changes to boolean flag values.

**Why:** Re-enabling or repairing an already-enabled component can materialize or reactivate its owned plugin configurations while its flag remains `true`. A boolean-only comparison leaves other processes serving old configuration slices even though their component switches look correct.

**How to apply:** A cross-process refresh must detect these same-value commits and invalidate dependent caches. Ordinary unchanged reads must not bump the cache revision. Failed reads represent unknown state: fail closed, do not interpret them as disabled flags or substitute defaults.

## Independent status authority

The Components page is a storage diagnostic view, not a trigger for runtime-cache synchronization.

**Why:** The user explicitly wants this page to remain a reliable source of stored enabled/disabled flags even when the runtime cache or its listeners fail. Making its read depend on refreshing that cache defeats the diagnostic purpose.

**How to apply:** Keep status reads independent of cache initialization and callbacks, including middleware before the route. Preserve authentication and maintenance boundaries; mutation and runtime gates still use their normal coordination. Only absent overrides justify declared defaults; failed reads are unavailable, and retained browser values are last-confirmed rather than current.
