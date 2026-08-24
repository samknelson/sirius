---
name: Notification receipt column
description: When a comm-link column stops being provenance and starts gating whether a message is sent again.
---

A column linking an entity row to the communication sent about it can be
promoted from provenance into a **receipt**: "this recipient has been told
about the row as it currently stands." Once it gates sending, three things
must hold together, or the feature leaks resends and lost notifications.

1. **Void it inside the entity write, not in the route.** The clearing belongs
   in the storage method that writes the row, expressed in the UPDATE itself
   (`SET link = CASE WHEN <values unchanged> THEN link ELSE NULL END`), so
   there is no read-then-write window and no future writer has to remember.

2. **Compare values semantically, not byte-wise.** An edit form posts every
   field each time while an untouched row often stores `null` or an object
   missing those keys. Compare with nulls stripped
   (`jsonb_strip_nulls(COALESCE(col,'{}')) = jsonb_strip_nulls($new)`), or a
   no-op save silently becomes a resend button.

3. **Guard the write-back with the snapshot the sender resolved from.** The
   recipient read must hand back the row's values, and the "record the comm"
   method must refuse when they no longer match. A send in flight otherwise
   stamps a receipt onto a row edited a moment ago and cancels the resend that
   edit earned. A sent-time ordering guard between two competing sends does
   NOT cover this — it only orders sends against each other.

4. **Receipt every row the one message spoke for, not just the linked one.**
   Where recipients are deduplicated (one person, several rows), the rows the
   send skipped still read as "never told" and re-message that person at the
   next trigger with nothing changed. Write the same comm id to each row in
   the group, each guarded by its OWN snapshot so a row edited mid-send keeps
   the resend it earned.

**Why:** the recipient read is the one place that decides who is messaged,
what link each gets, and which row the send is recorded against, so the
"already holds a receipt" condition belongs there and nowhere else; an empty
recipient list already stops the dispatcher.

**How to apply:** any notifier where re-entering a trigger state must message
only the rows that changed. Note the deliberate asymmetries to state in the
docs: a failed/undelivered send still counts as told (resend is forced by
editing the row, not by retrying), and deleting the comm row clears the link,
which hands the recipient back to the next send.
