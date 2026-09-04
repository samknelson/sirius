---
name: Nav section fed by a server registry
description: Rules for a navigation group whose items are derived from a server-side registry instead of hand-written.
---

A navigation group whose items come from a server registry at render time must
follow three rules:

1. **Every consumer of the section list gets the RESOLVED list** — including
   the active-item/path helpers. A helper still reading the static registry
   silently stops highlighting and auto-opening the derived items.
2. **Unresolved is not empty.** The usual "hide a group with no accessible
   items" filter cannot tell "nothing for you" from "no answer yet"; carry a
   resolution status so the group can say *loading* / *couldn't load*.
3. **One access decision, reused.** Every surface that offers these links
   (sidebar, landing page, any index page) filters through the same accessible-
   sections helper. An index that re-derives its own gate will offer links the
   destination refuses — especially where the destination is gated more tightly
   than the underlying data.

**Why:** deriving names from a registry is only worth it if every surface reads
it; each surface that keeps its own copy of the list, its names, or its gates
is where drift and dead links come back.

**How to apply:** when a group's items become dynamic, give the endpoint the
lightest gate its content justifies (a names-only catalog needn't inherit the
admin gate of the screens it describes), and let the destination's own gate —
not the data's — decide whether a link is offered.
