---
name: Unified startup via bootstrapApp (dev + prod)
description: Sirius boots from two entry files but shares ONE init sequence (bootstrapApp); add new boot-time init there, once.
---

Sirius has TWO startup entry points, but the ordered initialization sequence
is now CONSOLIDATED into a single shared function:

- **Shared init**: `bootstrapApp(app, server)` in `server/app-init.ts` —
  installs base middleware and runs the full ordered boot sequence (plugin
  systems, reconcile loops, cron registration, auth, routes, websocket, cron
  scheduler, error middleware). This is the single source of truth.
- **Dev**: `npm run dev` → `tsx server/index.ts`. Creates app/server, registers
  startup health routes, listens, then calls `await bootstrapApp(...)` and
  finishes with Vite (`setupVite`) + sets its own `appReady` flag.
- **Prod**: `npm run start` → `server/production-entry.ts` (health routes +
  listen) → `startApp()` in `app-init.ts`, which calls `bootstrapApp(...)` then
  `serveStatic` + `onReady()`.

**Rule:** add any new boot-time step (plugin-kind registration, a
reconcile/materialization loop, a registry init, a cache warm, an event
listener, a cron handler) inside `bootstrapApp` — ONCE. Do not re-add it to
`index.ts`; that file only owns dev-specific concerns (stale-dist guardrail,
Vite serving, appReady) and delegates everything else to bootstrapApp.

**Why:** before consolidation the two files each carried a duplicated
sequence and drifted — prod was silently missing `registerEntityLoader('dispatch')`,
`initDispatchSeniorityReset()`, and `registerWmbChargePluginListener()` (so WMB
charges were not event-driven in production). A step added to only one file
"works in one environment and not the other" with no error. The shared
function removes that whole class of bug.

**How to apply / verify:** both paths log each step with `{ source: "startup" }`.
After adding a step, confirm the new log line appears in the dev boot
(`/tmp/logs/Start_application_*.log`). The prod bundle is built by
`esbuild server/production-entry.ts server/app-init.ts ... --outdir=dist`; you
can smoke-bundle just those two files with that esbuild command to confirm the
shared module still compiles for prod without running the gated `db:push`.

**Tooling gotcha:** `rg -rn "pattern"` does NOT mean "recursive + line
numbers". In ripgrep `-r` is `--replace`, so `-rn` parses as `--replace=n` and
rewrites every match to the literal `n` in the output. ripgrep is already
recursive by default — use `rg -n "pattern"` for line numbers.
