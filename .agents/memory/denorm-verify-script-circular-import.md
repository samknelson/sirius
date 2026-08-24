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

**Durable lesson:** the crash is entrypoint-order, not module-specific — any
plugin-tree module used as a script's first import can hit it; always import
the storage barrel first in standalone scripts.

A simpler variant that also works (system-status details tests): a static
`import "../../server/storage"` as the very FIRST import of the script fixes
the evaluation order, letting later static imports of plugin registries and
even dynamic imports of route modules load cleanly.

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

**Reaching `_core/registry` at all (any plugin kind) hits the same wall:** it
cycles through the component-gating chain, so a script whose first import is
a plugin registry (or `_core/registry` itself) dies the same way. Awaiting
`import("../../server/modules/components")` first orders the cycle the way the
app does; the plugin registries then load cleanly. That import registers other
plugin kinds noisily, so silence winston first
(`for (const t of logger.transports) t.silent = true`).

**Storage reads that gate a join on a component** (EDLS assignments checking
`dispatch.job_group`, etc.) throw `Component cache not initialized` in a
standalone script even once the imports resolve. Fix: `await
loadComponentCache()` (from `server/services/component-cache`) before the
first storage call — the app does this during boot, an ad-hoc script does not.

Component gating in an author-time check: `listEnabledSync` throws without a
warm component cache, and warming it needs a database. When the check should
be DB-free and gating-independent, override `listEnabledSync` on the registry
*instance* (`Object.assign(reg, { listEnabledSync: () => reg.list() })`) —
patching `PluginRegistry.prototype` re-triggers the cycle above because it
requires importing `_core/registry` directly.
