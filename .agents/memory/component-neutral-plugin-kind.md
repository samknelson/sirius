---
name: Making a plugin kind component-neutral
description: What breaks when a plugin kind stops being owned by one component — the gate moves to each plugin, and three classes of consumer silently keep the old assumption.
---

A plugin kind that was born inside one component (declared `requiredComponent`
on its kind registration) can outgrow it. Un-gating the kind is the easy part;
the damage is in everything that was quietly relying on that gate.

## The rule

When you remove a kind's `requiredComponent`:

1. **The gate moves down, it does not disappear.** Each plugin keeps its own
   `requiredComponent`. The kind-level one was doing work for every plugin at
   once; per-plugin gates are now the only component checks, so verify each
   plugin actually declares one.
2. **Routes that inherited the gate need an explicit one.** Any route that was
   component-correct only because the kind was gated is now open. Give it an
   explicit `requireComponent(...)` — after the access check, not before, so
   component state is not disclosed to an unauthorized caller.
3. **Consumers stop being allowed to assume the kind's capabilities.** This is
   the one that gets missed. While the kind belonged to one component, every
   plugin in it happened to have the same shape, and callers hardcoded that
   shape. Once any plugin can join, an optional operation or an optional
   metadata field is genuinely absent, and a surface that offers a config it
   cannot use fails at the point of use (an unsupported-operation refusal, or
   an editor with nothing to edit).

   Report capabilities once, from the list endpoint that knows the plugins, and
   let each surface filter on the one it needs. Do not have every surface
   re-derive them, and do not filter the shared list down to one surface's
   needs — that makes the endpoint's name a lie for the next caller.
4. **Success rendering must not require the optional part.** A detail card
   built from one plugin's rich response becomes the condition for showing
   *any* success; a leaner plugin then reports a good result and renders blank.
   Gate the card on the optional data, gate the success message on success.
5. **Dynamically registered env vars must not carry the old domain.** A
   credential registered at resolve time under the founding component's
   category misfiles every later vendor's secret — and registration is
   last-write-wins, so the first one resolved can stamp its category on a name
   another declaration owns. Use the framework's own neutral category.

**Why:** the kind id, its subsidiary table and its generic CRUD addresses are
usually code literals rather than path-derived, so relocating the source
directory and un-gating is a pure code move with no data migration. That
cheapness is the trap: it makes the change look finished long before the
consumers have caught up.

**How to apply:** when un-gating, grep for every consumer of the kind's list
endpoint and ask of each one "what does this surface need the plugin to be able
to do?" — then check whether the plugin type actually promises it, or merely
happens to provide it today.
