---
name: Extraction seams — prefer alter hooks over bespoke registries
description: How to choose the seam when removing a component's references from core
---

When extracting a component, order of preference: move owned files → existing mechanism (manifest/generated bridges, plugin kinds, component events, existing context/rewrite registrations) → alter hook declared beside the core function that computes the result. Do NOT invent narrow typed setters/registries for specific lists or maps.

**Why:** the owner (Nov 2026) pushed back on a plan proposing ~a dozen bespoke registration points: the hook system exists precisely as "base implementation, components may alter it"; registering implementors is for big things like plugins. The earlier "no broad alter hooks" wording from the dispatch extraction was over-applied.

**How to apply:** exceptions need written justification. Hooks skip disabled components, so facts needed about a component's retained tables while disabled (boot assertions, orphan sweeps) belong in the manifest or an existing context registration. Hook run was async-only because the first consumer did DB work; synchronous hot paths need a sync run variant using the sync component-enabled check.

Core hook hosts must be imported before registration closes, independently of
whether any optional consumer happens to import them.

**Why:** A successful production build can hide declaration timing that fails
only during full startup with the optional source absent.

**How to apply:** Source-removal verification must execute complete startup and
route registration, not just compile or import the bundle.

When independent extractions overlap, keep an integration with its newly
established consumer owner and point dependencies toward the domain provider.
Reuse an incoming contribution mechanism instead of retaining parallel discovery.

**Why:** Competing relocations can create duplicate public routes or plugin
keys, or accidentally make a general domain require its optional consumers.

**How to apply:** Resolve ownership before imports, delete duplicate relocated
copies, and derive the source-removal closure from the merged declarations.
