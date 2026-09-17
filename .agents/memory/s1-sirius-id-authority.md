---
name: S1 Sirius ID authority
description: Ownership and allocation rules for worker Sirius IDs during S1 migration.
---

While S1 remains writable, S1 is the sole Sirius ID allocator. S2 may copy an authoritative S1 claim to its mapped worker, but must not invent numbers, including for relationship shells. Shell relationships use S2 UUIDs and need no authoritative SID.

**Why:** A production repair selected replacement shell numbers above the staged maximum, but live S1 had already allocated those numbers after extraction. A clean staging diagnostic and unchanged approval hash do not establish safety against a writable source. Matching displayed names also do not establish identity: a shell may map to a different S1 contact than an authoritative worker.

**How to apply:** Never solve source collisions by choosing a higher generated range. Preserve UUIDs and references; require proven shell provenance and a separately reviewed repair before retiring shell SID claims. Refuse missing/invalid authoritative worker IDs. Native S2 allocation must remain explicitly disabled until cutover.

An approval hash must bind the reviewed identity/provenance evidence, not only the resulting actions and numeric changes.

**Why:** A shell can still qualify for the same NULL retirement after its contact and source mappings change consistently. An action-only hash would accept approval granted for a different identity.

**How to apply:** Hash deterministic, sanitized evidence for the selected records and source claims alongside the plan. Recheck it under the repair's locks; do not hash unrestricted record payloads.