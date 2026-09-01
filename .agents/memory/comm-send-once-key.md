---
name: Comm send-once key
description: How at-most-once delivery works in the comm layer — where the key is normalized, why the insert is the claim, and the spent-key trade-off.
---

A caller can hand any send an optional key; the same key, to the same contact,
on the same medium is refused forever after the first send. The uniqueness
tuple lives on the communication row as a named UNIQUE CONSTRAINT (nulls are
distinct, so un-keyed sending is untouched and no partial index is needed).

**Normalize the key at the storage insert, not in the shared insert schema.**
The usual project pattern for "blank means absent" is a `.transform` on the
shared zod insert schema, and it would silently never run here: every sender
builds a plain object and calls the storage create method directly, without
parsing the schema. The storage create is the ONE insert boundary for a
communication row, so trimming and blank→NULL belong there. A blank string
left through is a real value to the constraint, which would make two unrelated
un-keyed sends collide with each other.

**The insert is the claim.** Conflict-tolerant insert + `returning()`, and
nothing coming back means "already sent" — never a try/catch on the unique
violation, which aborts the surrounding transaction (see
tx-race-onconflict-not-catch.md). Every sender already opens its transaction
and writes the comm row before calling the provider, so the claim naturally
lands before anything can reach the outside world. When the claim loses, the
sender must return before creating its medium sub-record.

**A duplicate is its own outcome, not an error.** The send result carries a
distinct already-sent flag plus the pre-existing record, separate from success
and from every error code, so a caller can point an operator at the message
that did go out without recording a failure that never happened.

**Why:** repeating jobs (threshold scans, reminder sweeps) re-derive the same
message on every run, and the comm layer had no way to say "this one already
went out".

**Trade-off — a spent key stays spent.** A keyed send that fails has still
consumed its key and is never retried, including failures unrelated to the
content (no opt-in, provider outage). Re-opening the key on failure puts the
race back, because "did it fail?" is only knowable after the provider has been
called. The failed comm row is the evidence. Callers needing retries must vary
the key.

**How to apply:** any new caller wanting at-most-once delivery passes a key it
can recompute deterministically. The read-side "already sent?" helper is an
optimization for skipping composition/budget only — it takes no lock, so two
callers can both be told "not yet"; the insert remains the guarantee.
