---
name: Per-plugin narrowing of kind-level envelope fields
description: How the shared plugin-config dialog constrains a kind-level field to what one plugin accepts, and why locked choices must stay clearable.
---

Envelope fields on a plugin-config adapter are **kind-level**: one list served to
the whole kind, rendered by one shared admin dialog. When an individual plugin
only accepts a subset of a field's fixed choices (an event notifier's
`supportedMedia` vs the shared Media checkbox group), narrow it through the
adapter's optional per-plugin hook that the config `/meta` route serves
alongside the kind-level list — never with a client-side special case for one
kind, and never by changing the kind-level list itself.

**Why:** the dialog is generic across every kind, and the kind-level list also
feeds the list page's filter bar, which must keep spanning all plugins. Without
narrowing, the form offers selections whose save is guaranteed to 400 — the
original symptom was a notifier offering Postal and rejecting it on save with an
opaque message.

**How to apply:**
- The narrowing is presentation only. The plugin's `validateConfig` stays the
  authoritative check; never rely on the metadata to enforce anything.
- Render an unavailable choice **locked with a visible reason**, not hidden — a
  hidden choice reads as "this feature doesn't exist".
- A locked choice that is **already selected** on the loaded config must stay
  togglable, otherwise a config saved before the plugin's capabilities changed
  can never be brought back to a savable state from the form.
- Gate per-plugin metadata with the same plugin gating as the rest of the meta
  response, so disabled components stay invisible.
- Rejections from these routes carry `{ message, errors[] }`: `errors` holds one
  readable line per problem (Zod issues formatted as "field — problem"), and
  `message` summarizes the first. Client toasts must render the list, not just
  the message, or multi-problem rejections collapse to one line.
