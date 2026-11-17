---
name: Background sync execution fencing
description: Ownership alone does not fence mutations made through other database connections; lease renewal may be blocked by a protected unit.
---

Keep background-run ownership for the whole operation, and fence each mutation unit and recovery against each other. Never infer that an executor stopped solely from a stale heartbeat.

**Why:** A lost session-level advisory lock does not stop JavaScript or writes using another pooled connection. A replacement can otherwise reconcile concurrently with an old executor. A transaction-held unit fence plus durable run-status checks lets recovery wait for the last unit and rejects subsequent old-executor units.

**How to apply:** Preserve partial work between units, make a unit transactional, and fence terminal writes too. Detached work must leave the request transaction while retaining the effective actor. Recovery marks interruption; it must never replay partial imports.

For sync throughput work, retain exclusion against noncooperating ID writers;
do not replace a table lock with an advisory lock merely to shorten waits.
Reuse mutable identity reads only within the protected transaction, invalidating
them on local writes, never across the whole import.

**Why:** Redundant queries can be eliminated without relaxing identity authority;
run-wide snapshots or early lock release permit another writer's changes to be
hidden during reconciliation. Local synthetic timings do not establish vendor
or production lock latency.

Lease renewal blocked by a protected business unit must fail conservatively,
even when the owner is the source of the blocking row lock. Do not bypass that
lock or extend local validity based on pending work.

**Why:** A lease alone cannot exclude an expired executor's in-flight
transaction. Serializing takeover with that transaction deliberately trades
possible interruption of slow units for mutation safety; a lost lease does
not imply cancellation of pending external requests.

**How to apply:** Keep ownership checks on the actual ambient business
transaction, separate from short maintenance-exempt coordination writes.
Lost owners stop at the next boundary, and uncertain history is recovered
without automatically replaying partial commits.
