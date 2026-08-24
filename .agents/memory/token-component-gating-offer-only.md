---
name: Component gating narrows the token OFFER, never a stored template
description: How requiredComponent on a token segment behaves — hidden from picker/tree/catalog, still valid, renders blank — and why validation/field-catalog are component-blind.
---

A token segment that belongs to an optional component declares
`requiredComponent`. What that gate is allowed to change:

- **The offer narrows** — flat catalog, browsable tree, picker, and the
  derived `path`/`url` leaves (which inherit the declaring plugin's
  component through the entity-location declaration).
- **The meaning of a written token does NOT.** Segment specs, the field
  catalog and the default-leaf lookup are built from the whole registry,
  not the switched-on part of it.
- **Delivery renders it blank.** A chain that reaches a switched-off
  segment is a *missing value*, not an unknown token; the resolver is
  never called, so an optional component's absent tables are never
  queried.

**Why:** a component is a per-deployment switch, and templates outlive
it. If validation followed component state, flipping a component off
would condemn every stored template naming one of its segments — the
author could not save an unrelated edit to that notifier/bulk message
without first hunting the token down — and delivery would shout
`[unknown token: …]` into a real message. This is the same rule the tab
arguments already follow: the picker drops choices whose component is
off while validation keeps accepting every declared choice.

**How to apply:** when gating a segment, `requiredComponent` is the
whole change; don't add offer-side filtering by hand. When touching the
validation path, keep the component-blind lookups blind — and note that
the field catalog therefore keys only on the registry version, not the
component-cache revision.

Watch for: a segment reachable from a GENERIC root (worker, contact) is
where this matters. Component-owned kinds that hang off their own
descriptors are only reachable on surfaces the component already gates,
so nobody notices which rule they follow.
