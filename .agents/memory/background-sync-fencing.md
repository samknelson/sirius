---
name: Background sync execution fencing
description: Session ownership alone does not fence mutations made through other database connections.
---

Keep background-run ownership for the whole operation, and fence each mutation unit and recovery against each other. Never infer that an executor stopped solely from a stale heartbeat.

**Why:** A lost session-level advisory lock does not stop JavaScript or writes using another pooled connection. A replacement can otherwise reconcile concurrently with an old executor. A transaction-held unit fence plus durable run-status checks lets recovery wait for the last unit and rejects subsequent old-executor units.

**How to apply:** Preserve partial work between units, make a unit transactional, and fence terminal writes too. Detached work must leave the request transaction while retaining the effective actor. Recovery marks interruption; it must never replay partial imports.
