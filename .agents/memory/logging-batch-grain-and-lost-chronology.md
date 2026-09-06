---
name: Batch-grain storage logging and retired chronology columns
description: Logging a whole-set replace under one config, why metadataMode 'none' is the wrong lever, and what to do with an ORDER BY whose column is being retired.
---

## A method that replaces a whole set is logged at batch grain

Some storage writes replace an entire collection in one call (a client's whole
grant set, a row's whole tag list). No single child row is "the record" the
entry is about, so the config must not claim one.

The rule: set `metadataEntityId: () => undefined` and give the config a
`hostTable` / `getHostEntityId` pointing at the parent. The parent gets a
sub-record touch; no child gets a provenance row of its own.

**Why not `metadataMode: 'none'`:** the middleware returns early on `'none'`
and skips the *host* touch along with the record touch, so the parent's
"something under this changed" stamp never advances. Leaving the mode at
`modified` and withholding only the entity id is what keeps the host half
running.

**How to apply:** whenever the logged method's own argument is a set rather
than a record id.

## A retired chronology column with no provenance replacement

Retiring a bespoke `created_at` usually means repointing an `ORDER BY` at
`entity_metadata.created_date` (a correlated subquery — there is no Drizzle
table object for that table — with `DESC NULLS LAST` and a stable tiebreak).

But that only works for rows that will *get* provenance. Children logged at
batch grain never do. For those, do not join provenance and pretend: reorder by
a stable business key and say so in the interface doc.

**Why:** a provenance join over rows that structurally have no provenance
answers "newest first" with an arbitrary order that looks authoritative.

## Credential material and the before-state

A logging config over a table holding secrets must redact in *both* directions:
the middleware persists the method arguments **and** the before/after state, so
the config's before-state reader has to return the same redacted projection the
after-state does. Log an id, a short key prefix, a label and `hasSecret`-style
booleans — never the secret, its hash, or the full key.

Methods that *take* a raw secret (a verify/validate call) are not config
changes and simply should not be logged at all.

**How to apply:** prove it after the fact — exercise every logged write, then
scan the stored log rows for the exact secret, for a bcrypt prefix, and for any
long hex run. A grep of the config is not the proof; the stored row is.
