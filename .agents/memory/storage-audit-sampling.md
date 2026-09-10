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
expensive audit path, and run metadata maintenance after every successful
mutation with the normal transaction/after-commit timing. Sampled failures may
remain owned by the loader's reject log.