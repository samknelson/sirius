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

**Related (storage tree):** the same TDZ crash pattern hits standalone
scripts that import a storage submodule directly: import the storage
barrel/singleton first so its module graph finishes initializing before the
direct submodule import.

**How to apply:** In a one-off verification script, import narrowly instead of
the barrel:
- `import "../../server/plugins/system/denorm/plugins/<plugin>"` (registers it)
- `import { backfillAllDenorm } from ".../denorm/backfill"`
- `import { recomputeStaleDenorm } from ".../denorm/recompute"`
A plugin with no `requiredComponent` passes `isPluginComponentEnabledSync`
without an initialized component cache, so backfill/recompute run standalone.

**Alternate pattern that works even when narrow imports still cycle:** make
the script's top-level import-free and use *sequential dynamic imports*,
loading the storage barrel first and awaiting it before importing anything
else:
```ts
await import(".../server/storage/index");
const { reg } = await import(".../plugins/<kind>/registry");
await import(".../plugins/<kind>/index"); // registers plugins
```
Each module graph fully settles before the next starts, which avoids the
`createCommStorage` / wizard-registry init crashes that static imports hit.
