---
name: Modal seeding runs in the render phase
description: Why a dialog must seed its form state during the render that opens it, not in a useEffect keyed on the open flag.
---

A dialog that fills its local form state from the record it was opened for must
do so **during the render that opens it**, via the shared `useModalSeed(open,
recordKey, seed)` hook — never in `useEffect(..., [open, record])`.

**Why:** the dialog body lives inside a Radix portal. On the FIRST open after a
page load (the dialog component itself usually only mounts once something is
being edited, already open), the body mounts and initializes from the still-empty
state, and the effect's seeding no longer reaches what the body captured — RJSF
in particular takes its `formData` at construction and its own defaults-driven
`onChange` lands after the seed. Symptom: first Edit shows blank selections;
close and reopen looks correct only because the previous session left the state
behind. Without the portal in the picture the same code sequences correctly, so
a stripped-down repro will NOT show the bug — reproduce with the real dialog.

**How to apply:** call the hook unconditionally at the top of the dialog
component; `seed()` may only set that component's own state. Choose `recordKey`
as "which record, in which shape": include anything the seed reads that can
arrive late (metadata/queries that are `enabled: open`), and nothing that
changes as the user edits, or a reseed will clobber their edits. Independent
values that arrive separately get their own hook call with their own key.
