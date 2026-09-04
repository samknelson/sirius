---
name: Cleaning up polymorphic children of a deleted record
description: The announce-plus-sweep pattern for rows that reference a parent by (context_id, entity_id) with no FK, and why every removal is per-record.
---

Rows that point at a parent through a plain `(context_id, entity_id)` pair
(notes, file attachments, and anything added the same way) have no FK, so the
database removes nothing when the parent goes. Clean them up in TWO layers:

1. The parent's storage delete announces itself with an after-commit
   `<entity>.delete.after` event; a per-area subscriber removes that area's
   children immediately.
2. A daily orphan-sweep cron anti-joins the area's table against each
   registered context's table and removes what layer 1 missed.

Both layers call the SAME removal routine for that area, so "remove this
record's notes" has one definition.

**Why:** layer 1 alone loses rows to a crash, a throwing handler, or a delete
path that predates the event; layer 2 alone leaves orphans (and stored bytes)
lying around for up to a day. Cleanup is after-commit and best effort by
design — it must never fail or roll back the delete itself.

**Removals are individual, never bulk.** A `delete … where id in (…)` removes
the rows and logs NOTHING: the admin log viewer is fed by the storage logging
wrapper, which is per-method-call. Read the ids, then loop through the logged
single-record storage method (the one that also disposes of side effects, e.g.
the attachment delete that removes the stored object). Continue past a failure
and report `{ deleted, failed[] }` rather than aborting the batch.

**How to apply:**
- One event per parent type, never a generic "an entity was deleted" carrying a
  type discriminator — nothing here dispatches on a payload field.
- The event→context-id mapping is written down explicitly in the subscriber:
  context ids are persisted in the data, event names are subscribed to by name,
  so the two vocabularies are independent. A parent type that is not
  note-able/file-able maps to null and is a no-op.
- Notes and files are SEPARATE registries with their own context id spellings
  (`trust_provider` vs whatever the other side uses); both spellings are
  persisted, so the two sides cannot be unified and share no code.
- A sweep needs a context→table map plus a boot assertion that every
  registered context has one, and must skip (and name) contexts whose
  component is off — a component-owned table may not exist at all.
- A new sweep gets its own cron plugin id; a cron id is persisted as a
  singleton config row, so folding a second sweep into an existing id retires
  the operator's ability to schedule them separately.
