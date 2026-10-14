---
name: Configuration coherency boundaries
description: Why shared configuration refreshes are scoped and must not claim fleet acknowledgment
---

Use durable PostgreSQL revisions for cross-process configuration freshness,
with explicit cache/subsystem participation. Do not turn this into a generic
cache flush or a cross-process domain-event broker.

**Why:** The approved scope deliberately separates configuration freshness
from authorization's existing five-minute cache window, cached business data,
vendor responses, cryptographic material and restart-only wiring. Making an
override map current does not make a boot-captured value live.

**How to apply:** Keep reload/restart classifications truthful, scope mutation
revisions to settings, and register executable refreshes only in their owning
server roles. Every infrastructure snapshot must leave ambient transaction and
after-commit contexts. Maintenance must not stop its own observer or require a
blanket write escape. Describe remote convergence as eventual unless real fleet
acknowledgments exist. See `docs/configuration-cache-coherency.md` for guarantees
and the current reviewed inventory.

## Cron failure granularity

Keep authoritative-read failures separate from per-job configuration failures.

**Why:** A persisted invalid cron expression must not prevent the owning API
process from booting, or prevent healthy jobs from being refreshed.

**How to apply:** Preserve the entire old schedule if the database snapshot
cannot be obtained. Once the snapshot is confirmed, skip and report invalid
individual jobs while applying healthy ones, at startup as well as on reload.
