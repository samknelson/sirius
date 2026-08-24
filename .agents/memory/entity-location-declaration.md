---
name: Entity location declaration (path/url tokens)
description: How a token entity kind says where its records live, and why routes are never spelled in a plugin
---

A token entity kind that has a page declares a LOCATION — the shared tab
registry's entity, the row field carrying that entity's id, and the tab a bare
token lands on. Everything link-shaped (`{{x.path}}`, `{{x.url}}`, the advertised
`path` field, the coverage check) derives from that one declaration through one
builder.

**Why:** the tab registry is already the route table the app's own tabs navigate
to. A route written into a plugin is a second copy, free to rot the first time
someone restructures a page, and the author cannot see either copy from the
editor. A kind that declares nothing offers no link token at all — an advertised
token that validates, previews and delivers blank is the failure mode this
framework treats as a bug.

**How to apply:**
- A sub-entity is not a special case: it is a location whose id comes from a
  foreign key (`idField !== "id"`), borrowing the parent page that LISTS it. The
  token description must say so, or someone later "fixes" it into a 404.
- Never assume a detail tab is called `details` — declare the tab id (the
  bargaining-unit tree calls its detail tab `view`).
- Validate declarations at boot (unknown tab, href template needing more than
  one id, id field the kind's rows cannot carry, a real `path` column that a
  derived one would shadow). A lying declaration otherwise surfaces as a 404 in
  a delivered message.
- A kind whose rows are ASSEMBLED IN CODE (a join, reshaped) has no table, and
  its declared extra field list IS its row: the id field is checked against
  table columns *plus* declared fields, and the field must be both declared and
  actually put on the row, or the coverage check calls it advertised-but-blank.
- An absolute-URL token is a wrapper over the path token, never a parallel
  implementation, and resolves to nothing whenever the path does — an origin on
  its own is not a link.

## Argument choices vs component state

An argument may declare its complete set of valid values. Shared validation
rejects anything outside it; the tree/picker layer filters the offer by each
choice's component gate (pipe-separated `a|b` means OR) and always keeps the
argument's own default.

**Why:** switching a component off must never invalidate a stored template that
already names one of its tabs, but the picker should not offer a page nobody can
reach. Same list, two readers.
