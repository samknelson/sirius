---
name: Notifier token roots must be truthful
description: Why a token root's name must be its entity kind and why flattened extras are a delivery-only failure; how a rename must migrate stored templates.
---

# A token root's name and fields are a promise about a record

A notifier declares named record roots; the token field catalog is built from what
a root DECLARES (its kind's table columns + any extras), not from what its
`build()` actually returns.

## The failure mode this creates
A field that is advertised but absent from the built row:
- passes save-time validation,
- renders a REAL value in the Template Studio preview (the picker's per-kind
  loader seeds a real row and may merge extras delivery never merges),
- and arrives BLANK in the delivered message.

Nothing anywhere reports it. This is the one gap author-time static checks
cannot see, so there are two guards: a static check on the declarations and a
development-only runtime comparison of the built row against the catalog at
seed time.

That runtime guard is only as good as its notion of "present": resolving a
catalog name through the entity's declared TABLE says the KIND has the column,
not that the built ROW carries it — a hand-built row satisfies a table-based
check for every column while holding none. Delivery reads `row[key]`, so
presence must be tested on the row itself.

## Rules
- **Root name IS the entity kind.** A shortened/prettified name describes the
  record as something it is not, and template authors then write fields that
  belong to the thing the NAME suggests rather than the row it holds.
- **No extras named after a related record's value.** Reach the related record
  (relation hop, or seed it as its own root). An extra only resolves for as long
  as every seeding path remembers to merge it.
- **Extras that ARE legitimate** are presentations of the record's own data
  (a status label, a legacy display-name fallback) or facts of the EVENT
  (added/removed, created/updated/deleted) that no column carries. Declare them
  on the KIND's descriptor, not on the root, and compose them through ONE shared
  helper the notifier, the preview provider and the personas all call — two
  implementations drift and the preview then lies about delivery.
- **Seeded related roots are gated on the component that OWNS the kind**, not on
  the (often narrower) component gating the notifier: two surfaces declaring the
  same root name must gate it identically or registration throws at boot.
- **A record the message is ABOUT is loaded; a record the event DELETED is
  reconstructed from the payload.** Skipping a removal notice because its row is
  gone would drop the one notice that matters.
- **The record must be the one the EVENT names, whole.** Two ways, and the
  row's mutability decides which:
  - immutable row (a history entry): load it by id from the payload; if it is
    gone, return null and skip — nothing truthful is left to say.
  - mutable or deletable row (an availability row, a job, a settlement, a
    membership): carry the WHOLE row on the event payload and render that.
    Re-reading it by id is a race in both directions — a later write rewrites
    the message the earlier transition earned, and a later delete swallows a
    notice that was genuinely earned.
- Carry the whole row, never a few copied values: hand-picked payload fields
  are the flattening problem again, one layer down.

**Why:** the grievance status notifier shipped a root named `grievance_status`
holding a `grievance_status_history` row with `grievance_title`/`status_name`
flattened on; both were fabricated and one duplicated what the status FK already
renders.

## Renames must migrate stored templates
Default templates live in code, but admin-customised ones are stored verbatim in
`plugin_configs.data.templates` and rendered verbatim. A rename without a
boot-time rewrite turns every customised token into `[unknown token: …]`.

**How to apply:** rewrite the PARSED chain (shared `TOKEN_PATTERN` +
`parseTokenChain` + re-serialize), never a text regex — the grammar allows
arguments in any order, arbitrary whitespace, and quotes/braces inside argument
values, and a text rewrite corrupts exactly the templates someone bothered to
customise. Leave unparseable tokens verbatim; the rewrite must be idempotent and
must not write unchanged configs.

## Rendering gotchas that force a derived extra
- `field()` formats any date/timestamp column through a TIMEZONE-LOCAL
  formatter, so a date-only column can render as the previous day. A wording
  that must show the stored date needs its own derived extra.
- A single-column FK to a table with a `name` column auto-renders that name, so
  a flattened `employer_name` is always redundant: point the template at the
  FK column itself.


## Related records ride on the event too

A root for a RELATED record (the job a foreperson change is on, the grievance
a settlement is on) must also come off the event, not a fresh read. A missing
related root aborts every medium, so a parent deleted seconds after the write
silently swallows a notice that was genuinely earned.

**Why:** two review rounds landed on this: re-reading is a race in both
directions — a later edit rewrites the message the earlier change earned, and
a later delete drops it.

**How to apply:** capture the parent row inside the writing transaction (wrap
the storage method in runInTransaction so the read and the write are one),
carry the whole row on the payload, and build the root from it with a pure
compose function shared with the live path. Values that are NOT columns
(denormalised names, joined category names) must ride along as their own
payload field, or the snapshot silently loses the derived extras the kind
advertises.

**Accepted boundary:** under READ COMMITTED a rename of the parent can still
commit mid-transaction. Left as-is deliberately — the parent is only NAMED by
the notice, and locking a hot parent row on every child write costs more than
the nuance is worth. What must never drift is the record the notice is ABOUT.
