---
name: Denorm verify script circular import
description: Why a standalone tsx script that imports the denorm barrel crashes, and how to run backfill/recompute in isolation
---

Running a standalone `tsx` script that imports the denorm barrel
(`server/plugins/system/denorm`) to invoke `backfillAllDenorm` /
`recomputeStaleDenorm` crashes with `ReferenceError: Cannot access
'PluginRegistry' before initialization` (thrown from
`server/plugins/wizards/registry.ts`). The barrel pulls in the dispatch +
wizard plugin trees, whose module-init order only resolves cleanly under the
real app boot sequence, not an ad-hoc entrypoint.

**Why:** ES-module circular init order is entrypoint-sensitive; the running
server boots fine because app-init imports things in the right order.

**How to apply:** In a one-off verification script, import narrowly instead of
the barrel:
- `import "../../server/plugins/system/denorm/plugins/<plugin>"` (registers it)
- `import { backfillAllDenorm } from ".../denorm/backfill"`
- `import { recomputeStaleDenorm } from ".../denorm/recompute"`
A plugin with no `requiredComponent` passes `isPluginComponentEnabledSync`
without an initialized component cache, so backfill/recompute run standalone.
