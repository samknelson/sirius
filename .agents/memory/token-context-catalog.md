---
name: Token contexts (what a studio's templates are about)
description: A token-editing surface names ONE context; its roots come from the shared catalog, never from the launch site or the host's catalog response.
---

A surface that opens the Template Studio names a token CONTEXT — an id — and
nothing else. The context is the single statement of that surface's complete
ordered root list, published through the shared catalog framework and read by
both halves: the editor's picker, the browsable tree, save-time validation and
any coverage check.

**Why:** the roots used to be stated at each launch site AND again server-side
in each host's catalog response. Two statements of "what may an author write
here?" with no rule about which one delivery agrees with: a root the editor
offered but the render had no record for validates, previews and then arrives
blank.

**How to apply:**

- Fixed surfaces declare their context beside the roots they already name;
  families (one per plugin) are GENERATED from the plugin registry and
  re-derived on every read, so a plugin registered late brings its context and
  one whose component is off takes its context away.
- A hand-written context must beat a generated one in BOTH registration
  orders. Do that structurally — declared map consulted first, generated ids
  skipped when already declared — not by import order.
- Reading the roots for an unknown context id THROWS. An empty root list is a
  plausible-looking editor offering nothing, with nothing said about why.
- A host endpoint may still exist, but only for what it alone knows: the token
  graph behind its own gate and the real records the author may preview
  against. It must not answer with a root list.
- A schema-stamped surface (a plugin's config form) gets its context id
  stamped at registration from the id the plugin is registered under. If the
  stamp is missing, the card must SAY the editor is not wired up — hiding the
  Edit button alone is indistinguishable from a surface with nothing to
  customize.
