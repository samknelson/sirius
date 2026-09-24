---
name: Vite (devDependency) leaking into the prod bundle
description: Why a top-level import of vite (or any devDependency) on the boot path crashes the lean ECS prod container, and the lazy-import fix.
---

A top-level `import ... from "vite"` (or importing any module that transitively
does) anywhere on the production boot path crashes the deployed ECS/Fargate
container at **module load** with `Cannot find package 'vite' ... ERR_MODULE_NOT_FOUND`.

**Why:** `vite` is a devDependency and is NOT installed in the lean production
image. The build (`esbuild --packages=external --bundle --format=esm --splitting`)
leaves external packages as runtime `import` statements, so the missing package
only fails when the compiled `dist/*.js` is loaded — before any boot code runs.
`serveStatic`/`log` in `server/vite.ts` are imported by `app-init.ts`, so a
top-level vite import there poisons the whole prod entry.

**How to apply:** Any dev-only dependency (vite, its config, dev tooling) used
only in a dev code path must be imported **lazily** with `await import(...)`
*inside* the dev-only function (e.g. `setupVite`), never at module top level.
Verify after building: `grep -E '^import .*"vite"'` over `dist/production-entry.js`
and `dist/app-init.js` must be empty; vite may only appear in a lazily-loaded
split chunk (e.g. `vite.config-*.js`) that prod never imports. Note: object
destructuring renames use `:` (`{ createServer: createViteServer }`), not `as`.
