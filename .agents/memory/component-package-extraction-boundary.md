---
name: Removable package safety boundaries
description: Optional source removal must preserve retained auth and identity safety; migration-data correction stays separate.
---

Treat an absent component directory as distinct from a disabled component. Retained authentication selections must not become permission to use a weaker authentication method. T631 synchronization must refuse as a whole without the installed, enabled identity authority; it must not guess worker identity or perform only the non-identity writes.

**Why:** The owner requires removable source builds against databases that still contain previous component tables and settings, without changing intended authentication or worker identity reconciliation. Refusing is safer than silently changing either authority.

**How to apply:** Preserve stable component IDs, independent switches and historical migration identities while changing directory layout. Component-owned behavior belongs behind generic host contracts, not disguised host literals. Freeman migration-artifact data correction remains separate from extraction; source removal is never authorization to delete retained data.
