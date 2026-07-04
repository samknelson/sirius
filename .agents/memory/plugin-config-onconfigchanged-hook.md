---
name: plugin config onConfigChanged hook
description: How a plugin kind invalidates an in-memory derived cache after a config CRUD mutation.
---

The generic plugin-config CRUD routes (`server/modules/plugins-config.ts`) fire an
optional `onConfigChanged()` hook on the kind's adapter after a successful
create/update/delete. It is the sanctioned way for a kind to invalidate any
in-memory derived cache it keeps.

**Why:** kinds that pre-index config rows in process memory (e.g. the
event-notifier dispatcher's event→configs index in
`server/plugins/event-notifier/config-cache.ts`) would otherwise serve stale
data until restart, because mutations only touch the DB. The hook is the only
place every CRUD path converges, so derived state stays correct without
re-querying on every read.

**How to apply:**
- Register `onConfigChanged: <invalidateFn>` on the adapter in the kind's
  `registerPluginConfigAdapter({...})` call.
- The route calls it best-effort (try/catch, errors only logged) so a cache
  failure never fails a request the client already saw succeed.
- It is NOT called by boot-time backfills that hit storage directly (they
  bypass the routes); that's fine for lazy caches that load on first read after
  boot.
- Caveat: this only covers mutations through the generic routes. Any future
  direct `storage.pluginConfigs.*` write outside those routes must invalidate
  the cache itself.
