---
name: New plugin kind needs client ALLOWED_KINDS allowlist
description: Adding a plugin kind to the server + manifest union is not enough; the generic admin config page has its own hardcoded client allowlist.
---

# New plugin kind: don't forget the client ALLOWED_KINDS allowlist

When adding a new plugin kind to the unified plugin framework, wiring the
server (kind registration in app-init, server `PluginKind` union) and the
client `PluginKind` union in `client/src/plugins/_core/manifest.ts` is NOT
sufficient for the generic admin page to work.

The generic admin config page (`client/src/pages/admin/plugin-configs.tsx`)
has its own **hardcoded `ALLOWED_KINDS` array**. If the new kind is missing
from it, `isValidKind` is false and the page renders
"Unknown plugin kind: <kind>" — entirely client-side, before any server call.
This looks exactly like a stale-server / unregistered-kind problem but is not.

**Why:** the page predates the kinds-index endpoint as a guard and keeps an
explicit allowlist of kinds the generic CRUD surface serves.

**How to apply:** when adding a plugin kind, add it to `ALLOWED_KINDS` in
`plugin-configs.tsx` too. It's a client-only change (Vite HMR, no workflow
restart). Symptom to recognize: "unknown kind" persists even though the
server boots cleanly with the kind registered and the code is confirmed merged.
