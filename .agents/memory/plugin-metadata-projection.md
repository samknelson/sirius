---
name: Plugin metadata projection
description: Compound component gates must survive registry and browser-manifest adapters.
---
Declaring a component requirement on a plugin is insufficient if its registry
adapter projects only part of the shared metadata. Availability and offered
views must use the same complete requirements.

**Why:** Several adapters manually copied the original single-component field
but omitted compound requirements. The type accepted the new gate while
execution and authoring still treated the dependent integration as available.

**How to apply:** When adding or using shared gating metadata, follow it through
the existing registry's availability projection and serialized manifest. Test
an unavailable secondary requirement, not just the founding component. Do not
replace these contracts with per-feature availability maps.
