---
name: Vite SSR transform exposes import cycles Node tolerates
description: Why server code that runs fine under tsx dies with "X is not a function" under the Vitest/Vite SSR transform, and how to fix the offending edge.
---

A module-initialization cycle that Node's native ESM loader tolerates will
throw under Vite's SSR transform, which is what the Vitest test runner uses.
The symptom is a `TypeError: <someExport> is not a function` raised from the
*top level* of a module that imports the export from a barrel, with a stack
that walks back through the cycle.

**Why:** Node ESM hoists `export function` declarations, so in a cycle the
function binding already exists when the other module's body runs. Vite's SSR
transform rewrites imports into namespace-object property reads assigned at
import time; inside a cycle the namespace is still partially initialized, so
the property is `undefined` at call time. The cycle is real in both cases —
Node just happens to survive it.

**How to apply:** do not reach for a runner config knob; there isn't one, and
externalizing local TypeScript modules is not possible. Find the edge that
points the wrong way — typically a low-level `services/` or `storage/` module
importing back into a high-level `modules/` route file — and break it. When
the call is already deferred (`setImmediate`, a timer, an event handler), the
cheapest correct fix is a lazy `await import(...)` at the call site with a
short comment saying which cycle it breaks; the module is fully initialized by
then.

Bisecting is fast: write a throwaway test that does nothing but
`await import("<module>")` for a few candidate entry points and run them
together. The failing stack names the exact edge.

**Related:** the same class of latent cycle shows up in the production esbuild
bundle as "Class extends value undefined" — see `esbuild-barrel-init-cycle.md`.
Two different bundlers, one underlying defect.
