---
name: Background sync execution fencing
description: Ownership alone does not fence mutations made through other database connections; lease renewal may be blocked by a protected unit.
---

Keep background-run ownership for the whole operation, and fence each mutation unit and recovery against each other. Never infer that an executor stopped solely from a stale heartbeat.

**Why:** A lost session-level advisory lock does not stop JavaScript or writes using another pooled connection. A replacement can otherwise reconcile concurrently with an old executor. A transaction-held unit fence plus durable run-status checks lets recovery wait for the last unit and rejects subsequent old-executor units.

**How to apply:** Preserve partial work between units, make a unit transactional, and fence terminal writes too. Detached work must leave the request transaction while retaining the effective actor. Recovery marks interruption; it must never replay partial imports.

For T631 worker imports, use cron as the only execution owner and results surface.
Do not reintroduce an independently launched worker sync or a second resource lease.
The removed Fetch Workers page should have neither navigation links nor a redirect.

**Why:** The owner approved consolidating manual and scheduled imports under cron
to eliminate duplicate locks, history, polling, and UI. One owner must still fence
business transactions; removing a duplicate lease is not permission to remove mutation safety.

**How to apply:** Manual imports use the existing cron Run page. Pass the cron
execution's authority into worker transactions, preserve complete results in cron
history, and drain old executors whenever ownership keys change across versions.

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

Server-side statement and idle-in-transaction limits complement, rather than
replace, mutation fencing. Keep business limits distinct from coordination
deadlines, and handle errors on checked-out clients explicitly.

**Why:** A stalled client can retain transaction locks after lease expiry; a
pool's idle-client error listener does not protect a checked-out connection.
Cancelling SQL alone can leave an aborted transaction holding locks when its
client never rolls back.

**How to apply:** Use transaction-local business limits and a checked-out-client
failure boundary; discard after-commit callbacks and interrupt the import on
database interruption. Recovery must still wait for database lock release, not
infer it from a termination request or an expired lease.
