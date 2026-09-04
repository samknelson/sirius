---
name: Context-filtered picker must not resend a value it no longer offers
description: Why an edit form that filters its choices by context has to omit (not resend) a stored id that has fallen out of the offered set.
---

A picker whose choices are filtered by the record's context (a file/note type
declaring which areas it applies to) can be looking at a stored value that is
no longer in its own choice list — the type still exists, someone just edited
its applies-to list after the record was saved.

**The rule:** seed such a control from the OFFERED set, not from the stored
value, and send the field only when the control was actually rendered. An
edit form that always resends the field turns an unrelated edit (a
description, a name) into a 400, because the server validates the pairing on
every write.

**Why:** the pairing check is the whole point of the applies-to list, so it
cannot be relaxed server-side; and a PATCH that distinguishes absent (leave
alone) from null (clear) already gives the client the vocabulary it needs.
Hiding the control while still submitting its state is the trap — the screen
then asserts something the user was never shown.

**How to apply:** whenever a select's options come from a filtered/scoped
list and the same screen edits other fields too — file types, note types, any
"applies to" option kind. Say plainly which of the two it is doing: offering
to clear a de-scoped value, or leaving it untouched.
