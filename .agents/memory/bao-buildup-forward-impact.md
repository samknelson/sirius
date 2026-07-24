---
name: BAO buildup forward impact is unbounded
description: Why no finite config-derived bound exists for how far forward a month's hours can affect buildup eligibility
---

The buildup plugin's `fetchBuildupStatus` walks backward from the
coverage month until a full buildup or a full break completes. Under
mixed above/below-threshold patterns that avoid both stopping
conditions, the walk can continue indefinitely, so a change to month
M's hours can affect coverage months arbitrarily far after M.

**Why:** `lagMonths + breakMonths` looks like a bound but is not — code
review produced counterexample classes (e.g. buildupMonths=3,
breakMonths=4 alternating) where the dependency exceeds lag+break while
still inside a 12-month rescan cap, silently under-queuing rescans.

**How to apply:** any "how far forward does month M's hours matter"
computation for buildup must report effectively unbounded
(Number.MAX_SAFE_INTEGER) and let the consumer cap it at its own span
limit. Never derive a finite bound from the buildup config.
