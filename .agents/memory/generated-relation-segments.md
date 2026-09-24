---
name: Generated relation segments (tokens)
description: Rules for deriving token relation segments from foreign keys — whose metadata describes a kind, and how a derived segment must defer to a hand-written one.
---

# Deriving token segments from foreign keys

Two sweeps derive relation segments from single-column FKs: into reference
data (named after the target TABLE, because the same segment name means a
different table under every parent) and between entity kinds (named after
the target KIND, matching every hand-written relation). Both share one walk.

## A kind is described differently by each plugin that produces it

Several plugins produce the same entity kind, and their metadata does not
agree: a relation describes the kind AS SEEN FROM ITS OWNER — its `name`
and `requiredComponent` are the owner's view ("Interview worker", gated on
the site-specific interviews component). Read as a statement about the kind
itself that is simply wrong.

**Rule:** anything derived about a kind (label, component gate) must come
from the plugin that produces it as ITSELF — the descriptor that matches no
segment, else its top-level entry from the root — never from whichever
producing plugin the code happened to encounter first.

**Why:** the first encountered producer is registration order, which is
import order. A generated relation inherited a site-specific component gate
from an unrelated plugin that merely happened to import earlier.

**How to apply:** whenever code merges per-kind facts out of a registry
where several plugins declare the same kind, rank the producers first.

## A derived segment must lose to a hand-written one, in both orders

A sweep can refuse to generate what is already declared — but only what is
registered by the time it runs, and registration is not a boot-only event.
The reverse order (derive first, hand-write later) needs the resolver's
help: segment lookup returns the FIRST match by (name, inputType), so the
derived segment must carry a `generated` marker the resolver deprioritizes.

Also skip when the target kind is ALREADY REACHABLE from that owner under
another name — a hand-written name says which relation it is
(`home_employer`), and a second, vaguer name for the same walk is worse
than no token.

## An owner walked once is not walked forever

Owners are memoized so a rescan is cheap, but when the sweep's TARGETS are
themselves registered plugins, a late target means every earlier owner was
walked against a graph that lacked it. Track a signature of the target set
and reopen all owners when it changes.

## What a derived relation may advertise

A relation resolves to a row, and the kind's field catalog is what authors
may write against it. A kind that advertises fields its table does not have
must be loaded through its own by-id loader; a generic row read would offer
those fields and render them blank. Where neither is possible, generate
nothing rather than advertise a lie.
