---
name: Dashboard widget registry glob depth
description: Where a shared client-side dashboard component may live, and why one directory deeper turns it into a phantom widget.
---

The dashboard's client component registry globs exactly one directory down
(`./*/*.tsx`) and keys each match as `<dir>:<File>`. A widget therefore lives in
its own directory named after the plugin id, and its component file's name is
half of the id the server plugin declares.

A component **shared** between widgets must sit one level ABOVE the widget
directories, beside the registry itself — never inside one of them, and never
in a directory of its own.

**Why:** anything one directory down is registered as a widget whether or not
it is one. A shared card placed in its own folder registers under an id no
server plugin claims: it renders nowhere, is reported by nothing, and the only
symptom is a registry entry that never matches. Placed inside an existing
widget's folder it registers a second id under that widget's name, which is
worse — it looks deliberate.

**How to apply:** adding a dashboard widget, or factoring a card body out of
one. If the new file is presentational and imported by widgets, put it next to
`registry.ts`. If it IS the widget, put it in `<plugin-id>/<Component>.tsx` and
make the server plugin's `client.component` spell out `<plugin-id>:<Component>`.
