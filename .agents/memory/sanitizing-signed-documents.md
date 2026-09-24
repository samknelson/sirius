---
name: Sanitizing hashed/signed document snapshots
description: The three rules for adding render-time sanitization to content that is also an integrity-hashed record of what someone agreed to.
---

# Sanitizing a document that is also a signed record

Ordinary stored HTML you just sanitize and render. Content that is a
*record of an agreement* — an e-signature snapshot, anything stored
alongside a hash — has three extra rules. Breaking any of them looks
fine on screen and is wrong.

## 1. Hash the RAW stored bytes, never the sanitized copy

An integrity check that hashes the sanitized string verifies the
sanitizer, not the record: tamper with the stored row, sanitize both
sides, and the hashes still agree. Sanitize for display only; feed the
verifier the untouched value.

## 2. Sanitize ONCE and submit that same string

Where a component both renders a document and records agreement to it,
displaying one string while submitting another means the stored, hashed
snapshot is not what the person read. Derive one sanitized value and use
it for the preview *and* the payload.

**Why:** the alternative (sanitize only the display) silently makes
"what you signed" and "what you saw" different documents.

## 3. Byte-difference is NOT appearance-difference

DOMPurify parses to a DOM and re-serializes, so it normalizes entity
spelling on the way through — a stored `&#10003;` comes back as a
literal `✓`. A naive `clean !== raw` comparison flags those as "this
document changed" and turns a real warning into noise people learn to
click past.

Compare entity-decoded on both sides instead; that is what
`sanitizeHtmlReportingChange` in the shared HTML library does. Only a
tag or attribute the policy genuinely removed survives that
normalization.

**How to apply:** when a change *is* real, surface it to the viewer
rather than silently rendering the rewrite — they are entitled to know
they are not seeing the whole document.

## 4. Render-path helpers must be TOTAL, not just correct

Anything called on hostile stored HTML *during render* has only two
acceptable outcomes: decoded, or left alone. Never "threw" — an
exception turns a defended page into a blank one, which is a worse
failure than the XSS it was added to stop.

The specific landmine: `String.fromCodePoint` raises `RangeError` above
U+10FFFF, and `Number.isFinite` does **not** screen for that. A stored
`&#999999999;` will crash a naive numeric-entity decoder. Validate for a
Unicode *scalar value* (integer, `0..0x10FFFF`, excluding the
`D800..DFFF` surrogate range) and leave anything else verbatim.

## Sizing the policy

Size the policy against the stored corpus, not against taste, and keep
the sizing re-checkable with a script that sanitizes every stored record
and reports losses. Signed snapshots are usually *wider* than the
authoring policy for the same content, because the signing page appends
its own generated blocks (inline-styled `div`/`span`) around the
authored body. Narrowing to the authoring policy would re-edit documents
people already put their name to — the goal is to stop script executing,
not to tidy up the record.
