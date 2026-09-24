---
name: Send-scoped token roots
description: What a token root whose record IS a send (a recipient + a medium) has to declare so preview, coverage and delivery agree.
---

A token root whose record is a SEND — a row that exists because a
message is going to somebody — is not just another entity root. Three
surfaces render it and they disagree by default:

1. **Delivery** knows the send and passes only the recipient's contact
   id down to the renderers. A send-scoped token therefore previews fine
   and arrives BLANK until delivery seeds the record itself, through the
   same composer the preview loads.
2. **Preview** derives its recipient from an explicitly seeded contact.
   The studio seeds only the root the author picked, so picking a send
   left `{{contact…}}`/`{{worker…}}` rendering personas beside a real
   send. The kind must declare its addressee (`recipientContactIdOf` on
   its `previewEntity` source) so the recipient roots resolve from the
   same person delivery would use.
3. **Coverage / "which recipients are missing a value"** loops over
   deduped CONTACTS. A send-scoped token is missing for everybody there
   unless the loop runs per send with the delivery seed; count people by
   deduping the failures back to contacts afterwards.

**Why:** the whole point of such a root is that preview == delivery. Two
of the three surfaces are silent when it is wrong — no error, just
sample data in a preview and a blank in a real message.

**How to apply:** when adding a root whose record pairs a recipient with
anything (medium, channel, attempt), touch all three before calling it
done, and gate the preview on the RECIPIENT (record-scoped
`contact.view` against the contact id), not on the surface's edit
permission — reading the send is reading the person it is addressed to.

Related, same shape: a kind's advertised field list is a deliberate
choice, not the table's columns — a status that is always "pending" at
render time is a preview/delivery mismatch waiting to happen.
