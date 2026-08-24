---
name: Real-record preview gating per token entity kind
description: How a token entity kind declares who may read one of its records for template preview, and why the declaration (not the offer list) is the authorization.
---

# Real-record preview is gated by the kind, per record

Previewing a template against a real record is a READ of that record. The token
plugin that owns the entity kind declares how such a read is authorized, and the
declaration is enforced on BOTH paths: every record OFFERED as a seed and every
load-by-id at render time.

The studio has no record finder. The container that opens it builds a studio
context server-side (roots + per root the personas and the records that may seed
it) and hands it over with the catalog it already fetches; a surface holding its
own records supplies them, anywhere else the kind offers what it would show
first. The offer is UX, not the boundary — the render route re-runs the kind's
gate on whatever id the client finally names, so a generous or stale offer can
never become an unauthorized read.

## The rule
- No declaration ⇒ the kind is not previewable at all. Silence is never "open",
  so adding a token entity kind does not quietly add a way to read its records.
- Two gate shapes, because the app has two: an ENTITY-scoped policy asked per
  record (on the subject id the record yields — an availability row is read as a
  read of its worker), and a broad ROUTE gate (role + component, no id) for kinds
  whose pages have no per-record policy. Preview mirrors whichever the app
  already uses; it never invents a stricter or looser rule.
- A record-scoped gate with no subject id REFUSES rather than falling back to the
  policy's id-less behaviour.
- Component checks stay in force: a switched-off component's kind lists nothing.

**Why:** the earlier design offered a fixed short list of recent records and the
OFFER LIST itself was the authorization — which is why it could allow neither
search nor load-by-id. Once authorization belongs to the record, both are safe
and the arbitrary limit is pointless.

**How to apply:** an author-time check validates every declaration (policy
exists, its registered scope matches the declared gate scope, search and load
both present) because a wrong policy id only ever looks like a permissions
problem at runtime. Keep the per-record check injectable so enforcement can be
tested without standing up users and policies.

## Derived fields on a picked record
A load must reproduce the row DELIVERY builds, extras included (status labels,
display-title fallbacks), through the same shared helper — otherwise the preview
renders something delivery never sends. Extras that only exist at event time
(an added/removed action, a created/updated/deleted operation) have no truthful
value for a standing record; the picker shows the wording of the event that
brought the record into being.

## Parity is NOT enforced
Preview-loader vs notifier-root-builder parity used to be checked against a
real dev-DB record by a registered validation. That check was deleted with the
rest of the token/studio test cluster, so parity is now an invariant you have
to hold by hand: a field the preview loader and the notifier root builder
disagree about renders one thing in the studio and delivers another, with
nothing to catch it. Event-time extras compare on the picker's
standing-record wording (fore "added", settlement "created").
