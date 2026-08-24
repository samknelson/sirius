---
name: After-commit sibling history boundary
description: Why an entity's history entry must be written inside the save's own transaction, and how a reader tells which save an entry belongs to.
---

When one handler WRITES history (a snapshot/audit row) and another READS that
history back to diff one save against the previous one, doing the write as an
after-commit reaction to the save breaks both halves — silently:

- **What it records.** An after-commit writer has to re-read the entity, which
  by then is "the entity now". A second save committing in between gets
  recorded under the first save's label.
- **Whether it is there yet.** Writer and reader are sibling after-commit
  handlers of the same save, none of them awaited. A save whose history row has
  not landed yet is indistinguishable, to the next save's reader, from a save
  that never had one. The reader compares against nothing, says nothing, and
  the miss is unrecoverable once the next baseline no longer holds the
  difference.

**The rule: write the history row inside the saving transaction**, from the
save path, not from a listener. History then exists exactly when the save it
describes exists, and anything running after a save's commit sees the history
of every save that preceded it. The price — a failed history write fails the
save — is the right trade when consumers diff that history to decide whether to
tell someone something.

**Second rule: order history by the save's own identity, not the row's
timestamp.** Capture the entity's `changed`/`updated` stamp inside the payload
and rank candidates by it; the current save's row carries exactly the current
save's stamp, so a strict `<` excludes it by construction. Read the stamp off
the raw payload to rank cheaply and decode only candidates. Old payloads
predating the stamp fall back to their write time — they are far enough in the
past to be unambiguous. And stamp such a column with the database clock
(`now()`), not `new Date()`: app hosts with skewed clocks order the same
entity's saves differently depending on who handled them.

**Third rule: a backwards search through history runs to the END of it.** A
"walk back N entries" bound looks prudent and is a silent wrong answer:
exhausting the window is indistinguishable from finding nothing, so the caller
concludes nothing changed. Page backwards until the history is genuinely
exhausted (a short page is the end) and keep the page size as a read-size knob
only; if a bound is truly required, exhausting it must be an error, never an
empty result.

Related trap in the same shape: when diffing "what changed since then", compare
against the UNFILTERED current read. Diffing against a read already narrowed
for another purpose (e.g. "rows not yet notified") reports every filtered-out
row as removed — silent, large, and user-visible.
