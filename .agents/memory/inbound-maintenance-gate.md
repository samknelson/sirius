---
name: Inbound maintenance refusal ordering
description: Where an always-on refusal for an inbound API mount has to sit in the middleware chain, and why later placements silently answer the wrong thing.
---

An always-on refusal for an inbound API mount (maintenance mode being the case
in hand) belongs at the **front of the entry point's middleware assembly**,
path-scoped to the mount — not inside the router it protects.

**Why:** everything upstream of the refusal is a middleware that can answer the
request first, and each one answers with its own vocabulary.

- Body parsers reject malformed and oversized bodies with 400/413. A caller
  whose real problem is that the site is down gets told their JSON is broken.
- Authentication is not read-only: it stamps a "last used" timestamp on every
  authenticated call, and maintenance makes every pooled connection read-only,
  so a gate placed after it never runs — the write fails first and the caller
  gets an opaque error.

Not everything upstream matters, though, and the question to ask of each one is
"can this *answer or fail* before my refusal runs, for the traffic this mount
actually receives" — not "does this touch the database". Session and passport
middleware sit ahead of every route here and are harmless: header-authenticated
machine callers carry no cookie, so the store is never read, and its writes
already go through the maintenance escape hatch anyway.

The refusal cannot then be logged, because logging is a write. Accept it; the
maintenance window is its own record.

**How to apply:** the refusal ends up registered far from the router it
protects, which is a drift hazard — the router's own code no longer shows
whether it is gated. Have the router's registration *assert* the gate was
installed on that app and throw at boot, so dropping or reordering the install
crashes instead of quietly reopening the doors. Prove the ordering with a test
that composes the app in the real order and asserts upstream work was never
*reached*; a unit test of the middleware in isolation passes just as well when
it is mounted in the wrong place.
