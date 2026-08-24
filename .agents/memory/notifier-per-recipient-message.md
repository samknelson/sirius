---
name: Per-recipient content in an event notifier
description: Why a per-recipient link can't come from token templates, and how to carry per-recipient data from getRecipients to getMessage.
---

An event-notifier whose message differs PER RECIPIENT (a link keyed by that
recipient's own row) cannot use the token-template path: the dispatcher builds
each declared record root ONCE per config-dispatch, before the recipient loop,
and shares them across every recipient and medium. Such a notifier composes in
`getMessage` and its wording is therefore fixed in code.

Resolve the per-recipient value ONCE, where the recipient list is resolved, and
hand it to message composition — do not re-derive it per message.

**Why:** re-deriving costs a query per recipient and can answer differently
than the recipient list did (ordering, concurrent edits), so two recipients can
end up with each other's link.

**How to apply:** any notifier where the message body is a function of the
recipient, not only of the event.

## Pre-filter SMS recipients on opt-in

The dispatcher's SMS delivery hands the number straight to `sendSms`, which
records a FAILED comm row for a number with no opt-in (and, outside `live`
system mode, for any number not allowlisted). A notifier that fans out to a
whole roster must therefore drop non-opted-in numbers in `getRecipients`, or a
single event litters the comm log with one failure per opted-out person.

Match the send layer's phone choice exactly when pre-filtering (it takes the
contact's ACTIVE PRIMARY number); filtering on a different number than the one
delivery would pick makes the pre-check meaningless. Opt-in rows are keyed by
E.164, so normalize before comparing against raw `contact_phone` values.
