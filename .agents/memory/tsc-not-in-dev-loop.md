---
name: tsc not in dev loop
description: Why type errors silently accumulate in this repo and can hide real runtime bugs
---

The dev server runs under `tsx`, which strips types WITHOUT type-checking, and
there is no build step in the dev loop. So `tsc` (`npm run check`) is the ONLY
thing that surfaces type errors, and nobody runs it during normal dev — errors
pile up unnoticed (grew to ~190 at one point).

**Why this matters:** several of those "type errors" were real runtime bugs, not
noise:
- `@googlemaps/js-api-loader` `setOptions` takes `{ key, v }`, NOT
  `{ apiKey, version }`. The old code used the wrong keys, so the API key was
  silently never applied.
- A postal write used non-existent columns (`letterId` instead of `lobLetterId`,
  plus `trackingNumber`/`carrier` which aren't columns at all) — the values were
  being dropped on write.
- `storage.options.eventTypes.get` / `storage.getRole` were calls to namespaces
  that don't exist on the storage object (correct: `unifiedOptionsStorage.get("event-type", …)`,
  `storage.users.getRole`).

**How to apply:** after any non-trivial `server/**` or `shared/**` change, run
`npm run check` before considering the work done. Treat a red tsc as "possible
real bug," not just "type annotation nitpick." Also note `admin.tsx` imported a
component file (`RoleAssignments`) that does not exist — a missing-module tsc
error meant that page was broken at runtime too.
