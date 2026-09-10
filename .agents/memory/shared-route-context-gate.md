---
name: One shared route serving differently-gated surfaces
description: How a route that answers for every surface takes its access policy from the resource named in the request, and what splitting one request into two breaks in the UI.
---

When several surfaces need the SAME derived answer (a vocabulary, a
graph, a spec) and differ only in who may reach them, do not copy the
route once per gate. Build it once and have it resolve its policy per
request from the thing being asked about.

- The request names a **declared resource** (here: a token context), not
  the underlying parameters. Root/scope lists come from the declaration,
  server-side, so a caller cannot widen what it is asking about.
- The gate lives in ONE resolver next to the declaration registry and
  returns a refusal or a policy id. Fail closed at every step: nothing
  named is a 400, unknown is a 404, declared-without-a-policy is a 403.
  No fallback policy — a fallback silently answers for a resource whose
  gate someone forgot to write down.
- **The refusal must agree with the client-facing catalog.** If the
  catalog of resources filters by component/availability, "this
  deployment offers no such resource" has to mean the same thing at the
  route, or a resource unreachable through the UI stays answerable by
  URL. Gate the SURFACE this way, never the meaning of stored data:
  validation of an already-saved template stays component-blind.

**Why:** the duplicated copies drift. Four routes building the same
graph is four chances for one surface to offer a token the save then
rejects.

## Splitting one request into two

Both halves used to arrive together; two things break the moment they
do not:

- **Readiness derived from "the data arrived" can fire out of order.**
  A `loading && !someData` shortcut that was safe when one request
  carried everything now lets the faster half declare the studio ready
  and start a dependent request with the slower half's inputs missing.
  Derive readiness from the request states, not from the payload.
- **Two failures need two places to be seen.** A shared-answer failure
  and a per-host failure must be reported on the panel each one feeds,
  with its own retry. One combined "failed to load" hides which is
  broken; worse, a half that fails while a neighbouring endpoint still
  works (a browsable tree with no typeahead and no validation behind it)
  reads to the author as "my tokens are fine".

**How to apply:** whenever a container's single fetch is split, walk
every boolean derived from the old response and ask which half it now
belongs to.
