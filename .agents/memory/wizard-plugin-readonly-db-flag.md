---
name: Wizard plugin needsReadOnlyDb flag
description: Where the readOnly.query opt-in flag lives for wizard plugins vs where the query lives, and how the encapsulation check treats it.
---

For wizard plugins the direct read (`storage.readOnly.query(...)`) lives in the
wizard's `server/plugins/wizards/engine/types/*.ts` implementation, but the
`needsReadOnlyDb: true` opt-in flag is declared on the thin
`server/plugins/wizards/plugins/*.ts` wrapper's metadata (not on the engine
file). The flag is surfaced through the wizard registry's `pluginToMetadata`
AND `pluginToManifestEntry` for audit parity with the other plugin-kind
registries.

**Why:** `scripts/dev/check-storage-encapsulation.ts` enforces the opt-in
per-FILE: a file under `server/plugins/` that calls `readOnly.query(` must
contain the literal `needsReadOnlyDb` OR be listed in
`READONLY_FLAG_EXEMPT_FILES`. Because the query is in the engine file (which
carries no metadata) and the flag is on the wrapper, the engine file would
fail the check. So each wizard engine file that does a direct read must be
added to `READONLY_FLAG_EXEMPT_FILES` (treated like `executor.ts` engine
infra), and its wrapper must declare the flag.

**How to apply:** When a wizard needs a direct read, (1) put
`storage.readOnly.query(...)` in its engine/types file, (2) add
`needsReadOnlyDb: true` to its plugin wrapper, (3) add the engine file path to
`READONLY_FLAG_EXEMPT_FILES`. The exemption list and wrapper flags are NOT
mechanically linked — keep them in sync by convention. Prefer inlining a
single-use read into the wizard over adding a one-off storage method
(mutations always stay in storage).
