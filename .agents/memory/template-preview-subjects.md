---
name: Template preview contexts (sample personas + real records)
description: How template previews may reach real data — the single entity-ref context form, how it is gated per entity kind, which roots are pickable, and how named sample personas are keyed by entity kind.
---

# Preview contexts

A template preview renders against either a **named sample persona** or a
**context the caller supplies in the request**. There is exactly ONE
context form: **entity references** — real records named by kind and id.

There used to be a second form, raw root VALUES the author already had on
screen, rendered as literal text. It was accepted on the route's plain
staff gate with no per-record check, so it needed a wall of guards
(scalars only, no `id`/`*_id`/`*Id` keys) to stop a forged foreign key
from reading back a real record through a relation. Nothing ever sent
it, so the form and its guards are gone — the remaining form is gated
per record, which is the check the guards were imitating.

**How to apply:** a retired shape is REFUSED, not ignored — by key
PRESENCE (`{"entity": null}` still names a shape this route no longer
has), naming the one accepted form in the message.

Nothing tests this. The script that drove the real route and asserted every
retired key is refused was deleted along with the rest of the token/studio
test cluster — the subsystem is still being designed, so the refusal is a
code-review responsibility, not an enforced guarantee.

## Which roots are pickable is studio context, not render output

Whether an author may pick a real record for a root follows from the
ROOTS alone — the kind declares how a preview read of it is gated, and
its component is on — so it is its own request
(`GET /api/template-studio/preview-roots?roots=…`, same staff gate as
the preview routes), fetched once when the studio opens.

**Why:** it used to ride along inside every render response, which made
the picker unusable until something had been previewed and made a fixed
fact look like it varied per render. Whether this author may read a
PARTICULAR record is the separate, per-record question the picker's
search answers.

Previewing against a real record IS a read of that record, so it is
gated exactly like any other read of it: the token entity kind's own
declaration says which access policy applies, and the same id is both
checked and loaded (no split authz/data lookup). **Fail closed:** a kind
that has not declared how it is gated cannot be used as a preview
context at all, so adding a token entity kind never quietly adds a new
way to read its records.

**Why:** an earlier design let the *editor* own the offer list — it
listed a few of its own recent records and re-listed on resolve to
authorize ("the offer IS the authorization"). That stitched three
different access models behind one endpoint and made the preview
endpoint's real gate invisible. Before that, any Studio user could
search and render *any* record of a kind — a PII hole.

**How to apply:** when a surface wants to preview against real records,
declare the gate on the token plugin that owns the KIND (one
declaration, inherited by every editor rooted at that kind) — never a
per-editor offer list.

## Sample personas are keyed by the entity kind that OWNS the leaf

Persona values are declared per token entity kind and looked up with the
`field(name=…)` argument, or the leaf's segment name for non-field
leaves. A chain like `{{worker.member_status}}` desugars to the
`member_status` kind's default leaf — so a `member_status` key on the
*worker* persona is dead weight and never renders. Declare the value on
the plugin that owns the produced kind, reusing the same persona id so
one pick tells one coherent story across kinds.

**How to apply:** nothing enforces this. The author check that verified every
persona key is a field of its kind (or a value leaf reading it) was deleted
with the rest of the token/studio test cluster, so a misplaced persona key
now fails silently — it just never renders.

A persona only earns its place if the DEFAULT templates render visibly
differently under it: a default that touches only fields no persona names
makes the picker look broken. Give each persona a distinct value for every
field the defaults use, including the record `id` behind a link path.

## Authoring affordances come from the studio context, never a render

What an author may CHOOSE (which roots accept a real record, which
personas exist) depends on the roots and the registry alone — never on
the template text, the picks, or a render. Serve it from the studio's own
context endpoint, fetched once when the studio opens.

**Why:** shipping a choice list inside the render response makes the
affordance unavailable until something has been previewed, and forces a
client-side "last good value" holding slot so the control doesn't blink
out mid-render. Two symptoms of one misplacement.

**How to apply:** if a client keeps a `useRef` of the last response just
to stop a control flickering, that data is studio context wearing a
render's clothes. Corollary: a pick keyed by root name must be reconciled
against the CURRENT offered roots (name AND kind) whenever they change —
otherwise the preview names a root the studio no longer offers, the
server refuses it, and the picker is gone so the author cannot clear it.

## Seedless (system) roots are never sampled

A root with no record behind it (`system` — site origin, today's date)
resolves for real in EVERY render, all-sample previews included. Its
values are identical in a preview and at delivery, and faking them hides
exactly what the author is previewing to catch: an unclickable link and a
wrong date format. Consequence: `preview.sample === true` means "every
RECORD is a sample", not "nothing here is real" — don't reintroduce a
consumer that reads it as the latter, and keep the studio's sample note
honest about it.
