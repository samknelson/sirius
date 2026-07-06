---
name: Generic plugin-config page is server-driven for kind validity
description: The generic admin config page validates :kind against the server kinds index, not a hardcoded client list — adding a kind no longer needs a client allowlist edit.
---

# Generic plugin-config page validates kinds from the server

The generic admin config page (`client/src/pages/admin/plugin-configs.tsx`)
decides whether a URL `:kind` is valid by checking the server kinds index
(`GET /api/plugins/kinds`, fetched via `pluginKindsQueryKey()`), NOT a
hardcoded client list. A kind appears there automatically once it has a
registered config adapter on the server (see `server/modules/plugins-manifest.ts`
`/api/plugins/kinds`, which loops `listPluginConfigAdapters()`).

**Why:** there used to be a second, hardcoded `ALLOWED_KINDS` runtime array in
the page that fell out of sync with the server (e.g. `cron` was registered
server-side but missing from the array, so the page wrongly showed
"Unknown plugin kind: cron" entirely client-side). That redundant runtime
allowlist was removed; the server is the single source of truth.

**How to apply:**
- Adding a new plugin kind: register its config adapter on the server and the
  generic page works automatically — no client allowlist edit required.
- You still maintain the `PluginKind` *type* union in
  `client/src/plugins/_core/manifest.ts` (and `PluginSearchParamsByKind`) for
  compile-time typing of the typed search helpers — those can't be derived from
  a runtime API response. But that is a type-only concern; the page does not
  gate on it at runtime (it casts the URL param).
- Loading order matters: the page must wait for the kinds query
  (`isLoadingKinds`) before rendering "Unknown plugin kind", or a valid kind
  flashes the unknown message during initial load.
