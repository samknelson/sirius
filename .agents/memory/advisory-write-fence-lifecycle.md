---
name: Advisory write-fence lifecycle
description: Safety rules for cross-process advisory fences around live HTTP and background writes.
---

Session-scoped advisory leases held around application work must use a pool
separate from the storage/query pool. Discard the physical session when an
explicit unlock fails instead of returning its unknown lock state to a pool.

**Why:** If each in-flight request pins one client from the same bounded pool
that its handler needs for database work, enough concurrent requests can all
wait for query clients while holding the leases that an exclusive operator
waiter needs released. An unlock error can similarly strand a session lock if
that client is reused.

**How to apply:** Give long-lived infrastructure leases dedicated connection
capacity. Verify queued-writer fairness and main-pool availability under many
simultaneous shared leases.

For Express-style request fencing, response `close` is not handler completion.
An aborted client can disconnect while its asynchronous handler continues
writing. Release only after the response is terminal and every tracked handler
promise has settled.

**Why:** Treating socket close as completion allows the exclusive operator
fence to begin while post-disconnect handler work is still mutating data.

**How to apply:** Track async work at the framework registration boundary and
test a disconnected client whose handler deliberately remains in flight.