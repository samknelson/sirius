---
name: Extraction seams — prefer alter hooks over bespoke registries
description: How to choose the seam when removing a component's references from core
---

When extracting a component, order of preference: move owned files → existing mechanism (manifest/generated bridges, plugin kinds, component events, existing context/rewrite registrations) → alter hook declared beside the core function that computes the result. Do NOT invent narrow typed setters/registries for specific lists or maps.

**Why:** the owner (Nov 2026) pushed back on a plan proposing ~a dozen bespoke registration points: the hook system exists precisely as "base implementation, components may alter it"; registering implementors is for big things like plugins. The earlier "no broad alter hooks" wording from the dispatch extraction was over-applied.

**How to apply:** exceptions need written justification. Hooks skip disabled components, so facts needed about a component's retained tables while disabled (boot assertions, orphan sweeps) belong in the manifest or an existing context registration. Hook run was async-only because the first consumer did DB work; synchronous hot paths need a sync run variant using the sync component-enabled check.
