---
name: Manual compose is render-then-fill, and the form is not a token surface
description: Why a one-off compose screen renders tokenized text into the form instead of sending it, and the foot-gun that offering a studio on an ordinary form creates.
---

A one-off compose screen (write one message to one person) that offers the
Template Studio does NOT send tokenized text. Closing the studio renders the
draft server-side and the finished strings replace the form's field values.
The send path is untouched, so no sender and no `deliver()` ever learns to
evaluate a token.

**Why:** delivery-time evaluation would be a second evaluation that can
disagree with the one the author just saw. Keeping the render in front of the
author is what makes "what you approved is what goes out" true.

**How to apply:**

- The render is not a preview: sample fallback OFF, so a token that resolves to
  nothing renders as nothing. A persona's name in text somebody is about to
  mail is indistinguishable from real content.
- Unknown tokens are reported per field and BLOCK the apply — the rendered
  string would otherwise carry the evaluator's `[unknown token: …]` marker into
  the form, where the next click sends it.
- The tokenized draft lives only in the studio component; apply is one-way.
  Re-parsing a finished letter back into tokens is guesswork, so reopening
  shows the draft, and overwriting hand edits is confirmed first.
- The client names ONE record and the server derives the recipient contact from
  it, re-gating BOTH through their own kinds' declared reads. A client that
  could also name the contact could name somebody else's.

**The foot-gun this creates.** The form stays an ordinary form. An author who
has just watched tokens work will type another one straight into it, and
nothing downstream evaluates it — the message goes out with `{{…}}` printed in
it. A screen that OFFERS the studio must therefore refuse to send text still
carrying token syntax, and say where to write one instead. Screens without the
studio stay untouched: there, braces are just braces.

**Closing the studio starts an async render while the studio stays editable.**
Snapshot the draft, and if it moved while the render was in flight, render
again rather than committing the older result — and refuse a second concurrent
render.
