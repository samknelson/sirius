---
name: Live staging range evidence
description: Safety rules for resumable daily staging against a high-churn source.
---

Daily staging of high-churn source bundles uses a generation-specific, exact observation boundary split into bounded identity ranges. The complete multi-bundle plan must exist atomically before extraction. Resume follows that persisted plan rather than recomputing ranges from the current source.

Stale deletion is authorized only by an immediately verified range. The delete, post-delete staged-count proof, and durable verified checkpoint commit in one target transaction under a lock on the pending checkpoint row. Uncertain ranges retain target rows. Inserts above the boundary and changes after a range's verification are deferred to the next new daily generation.

**Why:** A whole-source second scan made multi-million-row daily staging fail whenever one live row moved, while non-atomic range cleanup could turn an interruption into unverified deletion.

**How to apply:** Keep daily resumability range-scoped and generation-scoped. Include existing staged maxima when planning so source-to-zero deletes are observed. Never reuse this deferral contract in final-freeze, which must retain exact whole-source count and stability gates.