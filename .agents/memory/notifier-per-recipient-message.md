---
name: Per-recipient content in an event notifier
description: Recipient-scoped token roots must use isolated caches and the same resolved identities as recipients and receipts.
---

Use recipient-scoped roots for token values that differ per recipient. Event
roots may share a render cache; recipient roots and message variants must not.
Keep the recipient's resolved context distinct even when one event contacts
several workers, and never use a recipient's home employer when the message
means the employer of the triggering work.

Resolve the per-recipient value ONCE, where the recipient list is resolved, and
hand it to template composition — do not re-derive identity or bearer links
inside token evaluation. A missing required recipient context skips that
recipient rather than substituting another record.

**Why:** re-deriving costs a query per recipient and can answer differently
than the recipient list did (ordering, concurrent edits), so two recipients can
end up with each other's link. Render the same assignment generations and
values that the send's receipt guards cover, not an unrelated schedule digest.

**How to apply:** any notifier where the message body is a function of the
recipient, not only of the event. Studio event replay must be read-only:
it may read existing credentials but must never issue or rotate them. A
send-scoped context without a safely addressable preview record uses explicitly
fictional examples rather than guessing a real worker.

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
