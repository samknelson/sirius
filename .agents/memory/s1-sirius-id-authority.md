---
name: S1 Sirius ID authority
description: Ownership and allocation rules for worker Sirius IDs during S1 migration.
---

S1 `field_sirius_id` is authoritative for a staged worker. A missing, non-numeric, or out-of-range value blocks the worker load; the migration must not invent a replacement. Only relationship shell workers may receive migration-generated Sirius IDs.

**Why:** Generated IDs assigned to source workers or shells can collide with authoritative workers arriving in a later incremental stage. Renumbering the valid S1 worker is not an acceptable remedy.

**How to apply:** Reserve all staged valid IDs before shell allocation. Treat existing owners conservatively, displace only rows proven migration-generated through mapping/provenance, and require a separately reviewed, hash-approved repair rather than repairing during an ordinary loader run.