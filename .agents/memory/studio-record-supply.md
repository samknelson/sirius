---
name: Studio records are supplied, never found
description: Why the token/template studio has no per-kind record-listing hook, and what to do instead when a surface wants real preview seeds.
---

# Studio records are supplied, never found

A template editor is not a record finder. The container that opens the
studio states the roots AND hands over the real records for them; token
land only loads a record somebody NAMED, by id, and only for evaluation.
There is no per-kind "give me the first N records of this kind" hook,
and there must never be one again.

**Why:** an earlier round removed the studio's typeahead but kept a
server-side per-kind offer hook so notifier editors could show "a few
recent records". The studio then silently fell back to it whenever a
container supplied nothing, so a bulk message's employer root filled up
with unrelated employers captioned "not this editor's" — two different
meanings in one picker, and a read of records the message had never
heard of. The owner's rule: if a root has no supplied records, it is
previewed as a sample persona, full stop.

**How to apply:**
- `previewEntity` on a token plugin declares `gate`, `requiredComponent`
  and `load(storage, id)` only. A list/search method added to storage
  "for the picker" is the same mistake wearing a different name — the
  `listForPreview`-style methods that fed the old hook were deleted with
  it.
- A surface that wants real seeds passes them in
  (`recordsByRoot`, keyed by root name) from what it already holds, plus
  `emptyRecordsNotes` for its own wording when it holds none. Bulk
  messages do this with their recipients; notifier configs legitimately
  have nothing, because they describe events that have not happened.
- Supplied records are still gated per record before the author sees
  them, and the render route re-gates whatever id is finally named — the
  offer is UX, never the authorization boundary.
