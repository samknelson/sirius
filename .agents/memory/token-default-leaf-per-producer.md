---
name: Token default leaf is per-producer, not per-kind
description: Why a token kind's defaultLeaf must be repeated on every plugin that produces that kind, or the short form validates on some surfaces and not others.
---

A token kind's default leaf (what `{{contact}}` / `{{worker}}` renders
with no `.field(...)`) is declared in plugin METADATA, but it is looked
up two different ways:

- delivery/preview and the browsable tree ask the WHOLE enabled
  registry for "any plugin producing this kind that declares a default
  leaf";
- a surface's static validation asks only the spec list built for the
  roots that surface named — and that list drops every root plugin the
  surface did not name (relations and leaves are never scoped).

**Rule:** declare the default leaf on every plugin whose outputType is
that kind — the root AND each hop — hanging the value off one exported
constant so the copies cannot drift.

**Why:** if only the root plugin declares it, a surface that reaches
the kind through a hop but does not offer its root (event notifiers
deliberately do not offer the recipient-side roots) rejects the short
form as an unknown token while the picker offers it and delivery
renders it happily. The tree/picker and the evaluator use the unscoped
lookup; only validation is scoped, so the drift is silent until an
author saves.

**How to apply:** when adding a new hop that produces an existing kind,
copy `defaultLeaf` along with `entityTable` / `entityFields` (the same
kind-level metadata those hops already repeat). When choosing a kind's
default leaf, pick a field the record ALWAYS has — a NOT NULL identity
column beats a denorm extra that is often blank — and do not duplicate
what a neighbouring root already says.
