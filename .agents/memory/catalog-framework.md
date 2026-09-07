---
name: Shared catalog framework
description: What a "catalog" is versus a registry, and the invariants the shared/catalog/ framework enforces — read before adding a catalog or a consumer of one.
---

## The cut: provenance, not judgment

A **catalog** is a code-supplied list of what a deployment offers (permissions,
flood events, plugin types, the areas that can carry files or notes). A
**registry** is configured state that lives in the database (variable values,
plugin config rows, effective flood thresholds, component enabled-state).

**Why:** every other way of drawing this line — "is it important", "is it
admin-facing" — is a judgment call that gets relitigated per list. Provenance is
checkable: did it come from source, or from a row?

**How to apply:** a catalog answers "what does the code offer", never "what is it
set to". Configured values stay on the screens that already own them. If you are
tempted to put an effective value in a catalog entry, you want the other surface.

## Entries derive on read, always

The declaration holds an `entries()` **function**, called on every read, and
entries whose component is switched off are filtered out at that moment.

**Why:** materializing at startup means switching a component only works in one
direction, or needs a restart, or needs a cache-bust step that someone will
forget. Derivation makes both directions correct with none of that.

**How to apply:** never cache a derived entry list without keying on the version
token. Never move the filtering into registration.

## The offer is not the vocabulary

Filtered reads answer "what is on offer now". **Interpreting something already
stored** — a saved template naming a token, a stored config naming a plugin —
must read the *unfiltered* declaration list instead.

**Why:** the token framework already learned this. If validation reads the
filtered set, switching a component off retroactively invalidates data that was
legitimately saved.

## Restricted detail is code-supplied defaults

An entry may carry a second payload guarded by a permission. It holds **defaults
the code ships**, never values in effect.

**How to apply:** name the keys so it cannot be misread — `defaultThreshold`, not
`threshold` — or an admin screen will confidently display a number the running
system is not using.

An entry producing restricted detail under a catalog that declares no permission
for it is refused outright, and refused whether or not that entry is currently on
offer. A declaration error must not hide until someone enables the component.

## Only viewer-authorized reads leave the framework

The package barrel withholds the functions that take a tier as an argument, and
— less obviously, and the thing that was missed first time — it withholds the
**declarations** too. A declaration carries its own `entries()` producer, so
handing one out is handing out the raw entries, restricted payloads included,
with no reader in sight.

**Why:** a signature that accepts `"restricted"`, or an object you can just call,
makes leaking restricted detail a one-line mistake that looks like ordinary code
at the call site.

**How to apply:** entries reach a reader only through reads that *decide* the tier
from the reader. Stored data is interpreted through a separate **vocabulary**
projection — ids and names only, no payload open or restricted — which is exactly
why it is safe for that projection to skip the audience check and the component
filter. The general shape: the unfiltered path is only safe because it is also
the empty one.

## Fail closed, including for catalogs that don't need the check

Shared code cannot read server component state, so it is injected at startup
(same shape as the shared access-policy evaluator injection). Unwired, every read
refuses — including a catalog of purely core entries that would not have called
the check at all.

**Why:** letting a core-only catalog answer while unwired means the same read
starts refusing the day someone adds the first component-owned entry to it, for
reasons unrelated to the caller.

The injection also refuses to be replaced once wired: swapping it changes every
answer the framework gives.

## The version token needs a process identity

Registration count plus component revision is enough within a process and
useless across one. The same code booted twice produces the same count, so a
deploy that changes labels, permissions or detail without changing *how many*
catalogs exist yields a byte-identical version — and a validating HTTP cache
serves the old answer.

**How to apply:** the token carries a per-process identity. Tier is a **separate**
cache-key dimension, not part of the token: one catalog answers two ways, and a
resolved catalog reports which way it answered so a cache can key on it.

## Administering a catalog is a different read from consuming it

A consumer wants **the offer** — component-filtered. A screen that *administers*
the areas a catalog declares wants **the declaration** — unfiltered — so it can
list an area whose component is switched off and say so on the row instead of
silently dropping it.

**Why:** the file-area and note-area config pages already rendered that "component
is disabled" line. Switching them to the filtered read would have removed rows an
administrator is supposed to configure.

**How to apply:** the declaration read still decides the tier from the reader, so
it is not a back door. What it must never grow is a `componentEnabled` field —
that is configured state, and putting it in the framework breaks the framework's
own line. The endpoint asks the component registry itself and joins the two.

## A sync viewer over async permissions

The viewer answers synchronously; every permission check in this codebase is a
query. So the request-level helper **preloads the permissions the catalog names**
and closes over the answers.

**Why:** the alternative — a route hardcoding the permission it thinks the catalog
wants — drifts silently the day the declaration changes its mind.

**How to apply:** ask the framework which names a catalog mentions; never
hardcode. A viewer asked about a permission it did not preload **throws** rather
than answering `false`, because a quiet `false` is an unexplained denial for
someone who actually holds it.

## A catalog answer is a permission decision, so a client must not keep it

Keying a client cache on the viewer's identity is not enough. Same person, same
key, permission since revoked — the cached restricted payload is served again
with no second trip to the server, and a `private, no-cache` response header has
no say over an in-memory client cache.

**How to apply:** hold the answer only for as long as the screen is open (no stale
window, no retention after unmount). A tier that can change under a stable
identity cannot be cached against that identity.

This holds for *every* catalog, including one with no restricted tier and a
merely signed-in audience. The tempting exemption — "same payload for everyone
who can read it at all, so a few minutes of stale window is free" — reasons about
the permission dimension and forgets the component one. Audience and tier say
nothing about component state, so a held answer keeps offering a switched-off
feature's entries, and keeps *withholding* a newly switched-on one, for the whole
stale window. Derive-on-read is the property the framework exists for; a client
stale window is the one place it can be silently thrown away.

## Making an unfiltered inventory component-filtered changes what absence means

Migrating a bespoke "what exists" endpoint onto a catalog is not a like-for-like
move. The bespoke endpoint typically shipped the whole list plus a
`requiredComponent` on each row and let the client filter; a catalog filters as
it derives. The offered set ends up identical — but only for consumers that were
already filtering.

**Why:** the consumers that were *not* filtering were relying on absence being
impossible. Two shapes to look for, both silent:

- A consumer that treats a missing entry as "the answer has not arrived yet" —
  e.g. `resolved = everyNamedItemFound(...)`. A perfectly good answer that omits
  a switched-off feature's entry now reads as permanently loading.
- A consumer that looks up a *label* for one specific id it already has (a page
  title, a breadcrumb). Filtered out means no label, and it falls back to
  something generic. Check whether the surface is reachable at all with the
  component off — a route already guarded on the same component makes this moot.

**How to apply:** before switching a consumer to the filtered read, find every
place the old unfiltered answer was indexed by a specific id, and decide what
absence should mean there. Then check the *routes*: the middleware that refuses a
disabled item must keep reading the unfiltered declaration, or "switched off"
degrades into "no such thing" and the refusal stops naming the feature to enable.

## A catalog is one projection of a declaration, not its new home

Migrating a list does **not** mean every reader of the underlying declaration now
goes through the catalog. Sort the readers first; there are three kinds, and only
the first one moves:

- **Enumeration** — "what terms/lists/areas exist", for a config screen or the
  catalog browser. This is what a catalog is for. It moves.
- **A synchronous compiled-in resolver** — something that renders on every page
  and must answer without a request. Moving it onto the catalog turns a
  render-time lookup into a fetch: the whole app blocks, or flashes raw keys
  before the answer lands. It keeps importing the declaration directly.
- **Stored-value validation** — deciding whether a saved key is still recognized.
  This is interpreting stored data, so it reads the *unfiltered* declaration (see
  "the offer is not the vocabulary"). It stays put.

**Why:** the retirement bar ("delete a bespoke endpoint or a direct browser
import") makes every remaining direct import look like unfinished work. Two of
these three are supposed to stay, and both would break loudly-to-subtly if
converted. Say so in the catalog file itself, or the next migration re-opens the
question.

## The detail bag is a string-key seam — close it with a type, in one file

`CatalogDetail` is `Record<string, CatalogValue>`, so the declaration that writes
`defaultSingular` and the screen that reads it back agree only by convention.
Rename one side and **both halves still typecheck** while the screen renders a
confident "Default:" followed by nothing.

**How to apply:** declare the field names once, beside a writer and a reader, and
put all three in the shared file both sides already import. A rename is then a
type error rather than something a person has to notice. Two gotchas:

- Use a **type alias**, not an `interface`. An interface carries no implicit index
  signature, so it will not satisfy `Record<string, CatalogValue>` — the failure
  is at the declaration, and it looks like the framework rejecting your shape.
- Import `CatalogDetail` as `import type` from `shared/catalog/types`, not the
  package barrel. Shared declaration files are often on the boot path (the
  variable registry imports them), and a type-only import from the leaf is the
  version that cannot drag the framework along.

Have the reader return `undefined` for a malformed payload rather than asserting.
It is unreachable while both sides go through the file — but the failure it
guards against is a screen displaying an empty default as if it were real, which
is worse than showing no default at all.
