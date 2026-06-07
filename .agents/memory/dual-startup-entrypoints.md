---
name: Dual startup entry points (dev vs prod)
description: Sirius boots from two files with duplicated init sequences; new boot-time init must be added to BOTH.
---

Sirius has TWO separate startup entry points, each with its own (largely
duplicated) initialization sequence:

- **Dev**: `npm run dev` → `tsx server/index.ts`. The inline boot sequence
  lives directly in `server/index.ts`.
- **Prod**: `npm run start` → `node dist/production-entry.js` →
  `server/production-entry.ts` calls `startApp()` in `server/app-init.ts`.
  The prod boot sequence lives in `app-init.ts`'s `startApp`.

**Why this matters:** any new boot-time step — plugin-kind registration,
a reconcile/materialization loop, a registry init, a cache warm — must be
added to BOTH `server/index.ts` and `server/app-init.ts`. If you add it to
only one, it works in only one environment and the gap is silent: the dev
server can boot fine while a feature (e.g. a plugin kind never registered,
component-owned rows never materialized) is simply missing, or vice-versa.

**How to apply / how to catch it:** after adding any startup init, grep both
files and diff their sequences. Verify via the boot logs — both paths log
each step with `{ source: "startup" }`; confirm your new log line appears in
the dev boot (`/tmp/logs/Start_application_*.log`). A feature that "works
but logs nothing at boot" is the tell that you patched the wrong entry file.

**Tooling gotcha that masked this:** `rg -rn "pattern"` does NOT mean
"recursive + line numbers". In ripgrep `-r` is `--replace`, so `-rn` parses
as `--replace=n` and rewrites every match to the literal `n` in the output
(e.g. function names show up as `n`). ripgrep is already recursive by
default — use `rg -n "pattern"` for line numbers.
