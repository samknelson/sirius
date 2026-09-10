---
name: Medium message field declaration
description: One declaration per delivery medium (email/sms/postal/inapp) that every authoring surface shares, and the rules that come with it.
---

A message's fields are declared ONCE per medium, not once per authoring
surface (bulk messaging, notifier admin templates, one-off compose forms).

**Why:** three copies of the same medium disagreed — the same SMS body was
`message` on two surfaces and `body` on the third, and a blank email subject
was fatal on one and quietly became "(no subject)" on another. They were never
three kinds of message; a recipient only ever sees the medium.

**How to apply:**

- A surface differs only in WHICH declared fields it authors. It supplies
  templates for the keys it writes; an unsupplied OPTIONAL key is not rendered,
  not previewed and not required. That is how a bulk postal editor offers only
  a description while the medium still declares a letter body. Omitting a
  REQUIRED key is not a surface choice — it is the blank-required-field
  failure below, per recipient.
- A required field that renders blank is a recorded FAILURE against that
  recipient (a failed comm row / a failed per-contact result carrying the
  reason), never a substituted stand-in. A field built out of tokens can
  render blank for one recipient and not another, so the authoring form's
  check is never the whole check — check again per recipient at send.
- An email's plain-text alternative part is DERIVED from the HTML body at
  send. It is never authored and never stored: a second authored copy of one
  message is a second thing that can be wrong. An authoring API that still
  accepts one lets a caller send contradictory parts — reject the key.
- No read-time aliases for a renamed field key. An alias is a second name
  that outlives every rename; rewrite the stored templates in a migration.
- The rename stops at the authoring layer. Sender/transport APIs and the
  medium-detail tables keep their own long-standing names, and the dispatcher
  branch that maps one to the other is the documented crossing point.
