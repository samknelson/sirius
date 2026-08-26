---
name: S1 policy catalogue repair
description: Boundary between one-off S2 policy catalogue repairs and the recurring S1 policy loader
---

The legacy S2 policy identity repair from `R` / `Restaurant Plan` to `UH` /
`Unite Here Plan` must run as an explicit, guarded one-off, not inside the
recurring policy loader. The one-off updates the existing row in place so its
UUID and all references remain stable, requires an explicit apply mode, and
fails closed if both identities exist.

**Why:** `load-policies.ts` is an adopt-only resolver. Mutating the S2 policy
catalogue during a sync hides configuration drift and makes a loader retry
carry an unexpected destructive side effect.

**How to apply:** Run the report-only one-off first, review the target
catalogue, then run its explicit apply mode. Rerun the policy loader afterward
so missing S1 `id_map` entries are created.