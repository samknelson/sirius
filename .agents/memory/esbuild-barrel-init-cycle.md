---
name: esbuild prod bundle "Class extends value undefined" from barrel cycles
description: Why barrel re-export import cycles crash only the bundled prod server (not dev/tsx), and the direct-submodule-import rule that prevents it.
---

Symptom: prod-only boot crash `Class extends value undefined is not a
constructor or null` at a `class X extends Base` site, with a stack that runs
through the storage init chain. Dev under `tsx` boots fine.

**Why dev hides it:** native ESM (tsx) hoists live bindings across a circular
import, so `Base` is defined by the time the subclass is evaluated. The esbuild
prod bundle wraps each module in a deferred `__init`/`__esm` with a re-entrancy
guard; a cycle can re-enter the subclass module *before* the base module's
`__init` has run, leaving `Base` undefined at the `extends`.

**The trap:** a **barrel** (`index.ts` doing `export * from ...`) forces the
consumer to initialize *every* submodule the barrel re-exports, in barrel order.
If any of those submodules imports back into a module already on the init stack,
you get a cycle. Here: `server/storage/*` imports a plugin registry → that pulls
the `_core` barrel → the barrel re-exports a submodule that top-level-imports
`../../storage` → cycle. Only the registry that storage imports crashes; sibling
registries reached only from the app/route side are fine because storage is
already fully initialized by then.

**The rule (already documented in `server/plugins/_core/kinds.ts`):** any code
in the storage / boot chain must import `_core` **submodules directly**
(`../_core/registry`, `../_core/kinds`, `../_core/types`), never the
`../_core` barrel. And a barrel submodule that only needs another layer at
runtime should `await import()` it lazily inside the function (e.g. the singleton
seeder's storage access) so it never forms a top-level value edge.

**How to apply:** when adding a `class X extends <shared base>` in plugin/registry
code, or when a storage module needs a plugin symbol, import the exact defining
submodule, not the barrel. Verify with a bundled smoke test, not just dev:
`esbuild server/production-entry.ts server/app-init.ts --bundle --format=esm
--splitting --packages=external --outdir=<dir inside workspace>` then
`node -e 'await import("./<dir>/app-init.js")'` with a dummy `DATABASE_URL` — it
must reach plugin registration without the class-extends error (a later
missing-DB/connection error is fine). Build the outdir *inside* the workspace so
`--packages=external` deps resolve from `node_modules`.
