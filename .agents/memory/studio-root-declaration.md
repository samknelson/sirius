---
name: Token studio roots are declared, never derived
description: Why every token-editing surface states its own root list, what makes that list binding, and the two lists that are NOT the editor's list.
---

Every surface that edits tokenized text (bulk messaging, event notifiers, the
generic studio endpoint) states the COMPLETE ordered list of roots its authors
may start a chain from. Nothing is added from the registry — no helper derives
"all the ordinary roots" any more, and the tree/catalog/search builders return
exactly the named roots.

**Why:** a bulk message is a list of contacts. When root lists came from the
registry, its editor offered an `employer` root whose seed picker fell back to
"first 20 employers by name" — arbitrary companies the message had never heard
of. A root the surface cannot seed is a root its author should not be able to
write.

**How to apply:**

- A new token-editing surface declares its list in ONE module constant and
  feeds it to every endpoint it owns (catalog, tree roots, tree search,
  validation). Drift between those is the bug this prevents.
- What makes the declaration binding is the SEGMENT GRAPH, not the browser:
  `buildSegmentSpecsForRoots` drops root-input plugins that were not named, so
  a hand-typed token from an undeclared root is invalid. Scoping only the
  picker leaves the token typeable and silently deliverable.
- Relations and leaves are never scoped — what may follow a record is a
  property of the record, not of the surface. A recipient's employer stays
  reachable as `worker.home_employer`, which also says WHOSE employer it is.
- Save-time validation must use the same list the editor was built from, or the
  editor offers tokens that save then rejects.
- A surface that serves SEVERAL root lists from one endpoint set must take the
  scope from the URL PATH (`/tree/:scope/roots`) and derive the list from it.
  Accepting a client `?roots=` list — even intersected with the union of every
  scope the surface knows — lets one screen browse another screen's roots, so
  the picker offers tokens the render then refuses. Scope the "what can follow
  this type?" endpoint too, by walking the graph from the scope's own roots;
  expanding a type in isolation answers for a graph the caller cannot reach.

**Two lists that are deliberately NOT the editor's list:**

- Rendering at delivery is unscoped (`evaluateChain`). Recipient-side roots
  resolve from the recipient however the template was written; tightening the
  editor never changes what an already-stored template delivers.
- Postal merge variables are keys handed to Lob, whose templates are authored
  outside this app and cannot be read from here. Withdrawing a key there is a
  hole in a letter discovered on delivery, so that list keeps roots the editor
  no longer offers until someone checks the Lob templates.

**Trap:** every event notifier's default templates build their links with
`{{system.base_url}}`. A notifier root list without the seedless `system` root
passes typecheck and boots fine, then rejects the save of every notifier
config. When tightening a root list, validate the shipped default templates
against it before believing it.
