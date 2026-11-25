---
name: Component package extraction boundary
description: Why Freeman package installation and complete host integration extraction were deliberately separated.
---

Treat package installation/enablement and complete Freeman integration removal
as separate stages. Do not interpret remaining mixed host integrations as a
request to remove or redesign them during framework maintenance.

**Why:** The owner explicitly requested generic filesystem package discovery
and relocation of wholly Freeman-owned source first, with complete extraction
of cross-cutting Freeman behavior planned separately. Freeman migration-artifact
data correction is also separate work, not part of package extraction.

**How to apply:** Preserve stable component IDs, independent switches and
migration identities while changing packaging. Use the documented extraction
boundary in `docs/component-packages.md` when deciding whether a mixed host
integration belongs in a later extraction.
