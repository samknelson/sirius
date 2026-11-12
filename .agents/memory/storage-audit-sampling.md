---
name: Storage audit sampling
description: Why bulk-loader audit sampling must never suppress entity metadata maintenance.
---

Audit sampling may skip before/after hooks, descriptions, console output, and
`winston_logs` rows, but every successful mutation must still resolve its
record identity and maintain `entity_metadata`.

**Why:** provenance is now a shared record-history and ordering input. Tying it
to loader audit sampling makes a sample rate of zero erase all imported record
history, while larger rates produce arbitrary partial coverage.

**How to apply:** decide sampling before the method call, skip only the
post-state/description/audit-row path, retain any pre-read needed by metadata
entity or host resolution, and run metadata maintenance after every successful
mutation with the normal transaction/after-commit timing. Sampled failures may
remain owned by the loader's reject log.

Audit suppression is permitted only while the target positively reports
maintenance; unknown mode must mean full logging, never permission.

**Why:** standalone migrations deliberately do not arm the app's maintenance
write lock, and the general mode reader deliberately falls back to dev.
Neither state proves operator authorization to suppress audit history. Mode
can also change from another process during a long loader run.

**How to apply:** keep authorization independent of the boot flag and ambient
transaction snapshots. Reverify committed target state for new sampled
operations, revoke on uncertainty or maintenance exit, and await activation
before loader writes. Do not add a live-capable environment escape hatch.