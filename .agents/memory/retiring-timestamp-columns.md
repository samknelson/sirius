---
name: Retiring a bespoke timestamp column
description: The two traps in replacing a table's own created_at/updated_at with entity_metadata provenance — empty UPDATE sets, and reads that silently change meaning.
---

Retiring a table's own `created_at` / `updated_at` in favour of
`entity_metadata` is a seed-then-drop pair of migrations plus a sweep of the
reads. Two things bite that the diff does not show.

## An `updated_at` bump was hiding empty UPDATE statements

Any code shaped like `set({ ...changes, updatedAt: new Date() })` was
guaranteed a non-empty set. Strip the timestamp and `changes` can be `{}`, and
drizzle throws **"No values to set"** at runtime — a path that used to succeed
now 500s. Typecheck and lint see nothing.

**Why:** the timestamp was load-bearing as *syntax*, not as data.

**How to apply:** after removing the bumps, look at every `.set()` fed a
built-up object (`Partial<Insert...>`, a `matchUpdates` accumulator, a
caller-supplied patch) and decide what "nothing to change" means — usually
return the record unchanged rather than issuing a statement. Exercise the
no-op path; it is the one nothing covers.

## "Last changed" changes meaning when it moves to provenance

`updated_at` was bumped by every statement that touched the row, including
bulk sweeps. Provenance is written by the storage logging middleware **per
logged method**, so a bulk statement advances nothing and an unlogged method
(a status setter missing from the logging config) leaves a record looking
untouched. Any read that *chooses* by recency — "promote the most recently
changed sibling" — gets a different answer.

**Why:** provenance answers "when did someone change this record", not "when
was this row last written".

**How to apply:** decide which question the read actually wants and say so at
the call site. If it wants provenance, also check the table's logging config
covers the methods that mutate it, or the new answer is quietly wrong. Also:
provenance can be NULL (best-effort, off the caller's transaction), so every
ordering needs an explicit `NULLS LAST` and a stable tiebreak — the column it
replaces was `NOT NULL`.

## A statement that reaches sibling rows has to report them itself

The middleware's grain is one record per call, so a "clear the other primary"
sweep inside a logged method leaves those siblings with no provenance at all —
and they are exactly the rows the recency read then ranks. Funnel every such
flip through one module-local helper that narrows the statement to the rows
that really change (`... AND flag = true`), returns their ids, and reports them
with the same discipline the middleware uses: after commit, outside the
caller's transaction, best effort, actor from the request context.

## A method with two outcomes needs a per-call metadata mode

`created` vs `modified` was a static field on the method's logging config,
which cannot describe a create-or-match. It now also takes a resolver over
`(args, result)` — and the method returns which outcome it took, so a match
that wrote nothing is logged as nothing while a match that changed something
is a modification. Do not reach for `shouldLog` alone: suppressing the branch
hides a real write instead of describing it.

## A create-shaped method that is the only entry point needs its own entry

The logging wrapper is applied at the storage factory, so an internal
`this.createX()` call does not pass through it. A wrapper method like
`createOrMatch...` that callers actually use must be listed in the logging
config itself, with `shouldLog` narrowing to the branch that really created
something — otherwise the match branch stamps a "created by" on a record
somebody else first entered.
