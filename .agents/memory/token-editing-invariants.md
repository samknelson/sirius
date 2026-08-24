---
name: Token editing invariants
description: Owner-stated rules for where tokenized strings are edited, what a token evaluation is, and whose job it is to clean the result.
---

# Token editing invariants

Owner-stated, authoritative. These are product invariants, not code
observations — the code has drifted from them before and will again.

## The studio is the only door

A user only ever edits a tokenized string inside the Template Studio.
Any token tooling at all — picker, tree/browser, live validation,
preview, context — means you are in the studio. There is no second door.

**Why:** every piece of token tooling has to agree about roots, gating
and shaping. A second surface with its own half of the tooling is a
second, quietly divergent answer to all of it.

**How to apply:** when a host wants token help in its own popover or
inline editor, that is a request to open the studio, not to grow a
parallel one. Two adjacent things are NOT this case and stay allowed:
editing the *result* of an evaluation (plain text, no tooling), and
raw-editing a tokenized string with no tooling at all.

## Verbatim fields get no token affordance

Some fields in a delivery spec are declared literal — the destination
sends them exactly as typed (a link URL, an external id). Inside the
studio they render as a plain input, and a token picked while one of
them holds focus is REFUSED, not redirected into the last tokenized
field the author touched.

**Why:** offering insertion there would ship braces to the recipient,
and silently inserting somewhere else moves text out of view of the
caret the author is watching.

**How to apply:** read "literal" off the shared delivery-field spec —
it is the same declaration delivery uses, so the two can't disagree.
Never add a second, studio-only flag for it.

## Evaluation is a medium-independent string operation

A token returns text. It does not know or care about the destination.
The token catalogue is deliberately medium-independent: tokens do not
vary by medium — *shaping* does.

**How to apply:** never branch a token's own evaluation on email vs SMS
vs in-app. Push the difference into the container that receives the text.

## Cleaning belongs to the container, and ignores position

Cleaning the rendered text for its destination is the container's job.
A clean callback may be told the value **and which token produced it**,
so a container can treat different tokens differently — and nothing
else.

Cleaning must NOT depend on a token's position in the surrounding
template. A token's value must not change because of what the author
typed before or after it (position-aware sanitization was proposed and
rejected outright).

**Why:** the goal is modest and local — `Sam > Nelson` should render as
`Sam &gt; Nelson`. The goal is NOT guaranteed-valid markup, and NOT that
a page can never render badly. Aiming at those is what tempts you into
reading the surroundings.

**How to apply:** an HTML container's cleaning ESCAPES, it never
allow-lists. Escaped text is safe anywhere in the document, including
inside a link address (shipped templates do build hrefs out of tokens),
and an allow-list decision would need to know where the value sits.
Sanitizing the finished string is a separate, later step. A token's
`emitsHtml` declaration is information the container may consult, not an
override the token asserts — a plain-text destination has no reason to
care.

## Tokens are plain text in the rich editor, normalized on serialize

In the studio's visual (rich-text) editor a token is ordinary `{{...}}`
text the author can type, edit and copy — not an uneditable widget.

**Why:** a widget can't be copied out as its token, can't have one
argument edited in place, and only *looks* authoritative — it never was
the validator. Validation is the studio's re-analysis of the whole
authored string plus the preview pane, both of which see plain text.

**How to apply:** the thing a widget really bought was atomicity, so buy
it back at serialize time instead: before reporting a change, flatten
each `{{...}}` run back to plain straight-quoted text (inline markup
from bolding across it, smart quotes and nbsp from a word processor).
The token grammar is strict enough that a token carrying any of those is
not even *extracted*, so it would deliver as literal text with no
warning at all. A run must never cross a block boundary or `<br>` —
`{{` on one line and `}}` on the next is prose. Normalize a clone of the
DOM (never the live one, or you move the author's caret), and repair
runs back to front so one pass fixes a document with any number of them.

## Read-only surfaces show token text, never a friendlier stand-in

Anywhere a saved tokenized string or a browsable chain is DISPLAYED, the
author sees the real text: `{{contact.address.field(name="full")}}`,
braces and the `field(name=…)` call included. Chip styling is allowed
(tokens should look different from literal text); rewriting is not.

**Why:** a one-word label derived from the catalogue or the last chain
segment collides — two unrelated tokens read the same — and a collapsed
`contact.address.full` sends the author looking for a token that does
not exist in that form. The rendered PREVIEW (real sample values) is a
different thing and stays as it is.

**How to apply:** no display helper may derive a human label from a chain
or collapse a segment. A human label may sit ALONGSIDE the true segment
(a field row's name), never in place of it.

## A field's medium was three questions, not one

A delivery field declares them separately: the SYNTAX it is written in
(what cleaning must mean for it), the SAFETY rule its finished value
must satisfy, and whether it is TOKENIZED at all.

**Why:** they were once one `media` enum, which quietly made "not
tokenized" a kind of medium and made a whole-value safety rule look like
a container syntax. Only one of the three decides whether evaluation
happens at all.

**How to apply:** a field that is not tokenized resolves no cleaning
function — that is the signal never to evaluate it, on every path.
