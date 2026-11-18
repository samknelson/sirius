# Cron ownership through semaphores

All DB-backed api-user replicas contend for `cron:scheduler` in the core
`semaphores` table. Only its owner schedules automatic work. Standbys retry
every 5–10 seconds and log transitions, not every contention. Startup does not
wait for election. Other service roles never start scheduling.

Every manual or scheduled execution claims `cron:execution:<full plugin ID>`.
Configurations and test/live mode share that key. Contenders record a skipped
run rather than queuing or retrying. Different plugins run concurrently.

## Lease lifecycle

The row contains its resource key, owner boot UUID, random per-acquisition token,
and timestamptz expiration. Owner UUID is attribution, not a foreign key:
process-registry retention, shutdown flags and stale heartbeats never release
ownership. No audit/history metadata is generated for semaphore operations.

Claim is atomic; renewal and release compare the token. Expired leases cannot
be renewed. Leases last 30 seconds, renewed every 5 seconds using database time.
Each operation checks out a connection briefly and releases it after its short
transaction. There is no connection reserved between operations and no advisory
lock used by cron ownership itself. The whole checkout/transaction is bounded to 5 seconds;
statements to 4 seconds and row-lock waits to 2 seconds. Uncertain connections
are destroyed. A delayed checkout is destroyed rather than used after timeout.

Local validity uses a monotonic deadline measured from the START of the claim
or renewal request. Late responses cannot revive a locally expired owner.
Renewals are serialized. Failed/ambiguous renewal withdraws authority; an
execution never reacquires. The scheduler invalidates timers and queued
callbacks on loss and may enter election again with a new generation.

## History and maintenance

Running-history admission, recovery and normal terminal writes take the
semaphore row lock in a short transaction, check current unexpired ownership
before and after the write, then commit. No admission precedes acquisition.
An old executor cannot overwrite a run already reconciled as interrupted.
Only running cron execute rows for the same plugin are recovered; there is no
replay and no age-based claim that an old executor is dead.

These coordination transactions bypass maintenance read-only mode solely for
semaphores and guarded run-history (including T631). Plugin work is never inside them. Existing
role/component/maintenance execution gates remain in effect; maintenance
startup deferral still applies. Coordination is independent of ambient job
transactions. Process heartbeat observations are not used as lease authority.

Manual interrupted and skipped executions return their exact run ID, so the
existing run page can display their terminal state and reason.

## Shutdown and limits

Orderly scheduler stop revokes local callbacks before bounded release.
Still-running executions keep separate leases across reload/leadership change.
Finished executions release their own token. Process termination does not drain
arbitrary job code: unfinished leases expire after exit. A failed release is
safe to leave for expiry. A crash therefore permits takeover after lease
expiration plus standby retry/database latency, not a guaranteed exact delay.

Expiration does NOT prove the old process stopped. Event-loop pauses or network
partitions can leave old JavaScript or external requests running after takeover.
These are coordinated starts, not exactly-once effects or universal write
fencing. T631's resource-specific mutation fencing remains essential. No generic plugin
cancellation or automatic replay is introduced.

## T631 worker import ownership

Manual **Sync Workers** and scheduled T631 worker imports additionally claim
`t631:sync-workers`, across all configurations and test/live modes. This is
separate from `cron:execution:sitespecific-t631-worker-fetch`: a cron execution
owns its outer execution lease, but must also contend with manual imports for
the T631 resource. T631 contenders return the existing active run (or a start/
finishing-unit conflict), never queue or automatically retry an import. Raw
diagnostic fetches and historical one-off tools are not coordinated imports.

T631 uses the same boot UUID, per-acquisition token, 30-second lease,
5-second renewal cadence, monotonic local deadlines and bounded coordination
operations. There is **no dedicated ownership connection** during vendor
requests, between workers, or between coordination operations. Failed or
ambiguous renewal permanently withdraws that executor's authority. A waiting
cron caller is rejected promptly on lease loss; this does **not** cancel an
already pending remote request, and loss of the outer cron lease does not
cancel arbitrary plugin code or revoke the independent T631 lease.

Each worker change and missing-worker deactivation runs in its actual ambient
business transaction, retaining identity table locking and per-worker commits.
The transaction first takes the retained transaction-level advisory fence
`2032002`, then locks the semaphore row. It validates the token, boot UUID,
database-clock expiry and local validity before and after the unit. The
semaphore row remains locked through commit or rollback: takeover cannot
overlap that unit even if its lease expires. Row-lock acquisition is bounded
to two seconds, but business work has neither the coordination maintenance
override nor its five-second whole-operation deadline.

A long unit can delay renewal long enough that renewal fails. This is a
conservative interruption, not permission to continue: the next validation
rolls the unit back, including after-commit callbacks. It is preferable to
silently extending an expired owner's authority. A unit already validated
and committed before replacement admission remains a legitimate partial
commit. Existing reconciliation and throughput rules are unchanged.

Admission/recovery and terminal history writes use short, bounded semaphore
transactions, validating ownership before and after the write and sharing the
same transaction fence with worker units. Recovery interrupts abandoned
running T631 rows and inserts a new run atomically when requested. It cannot
pass an old protected transaction. Status polling can acquire the resource
and recover abandoned history; if a protected unit blocks acquisition, polling
still returns durable history without presuming that unit is dead.
Heartbeats and process telemetry are observational only.

An expired, superseded or locally lost executor cannot begin another unit or
publish success. Late replies are discarded, and conditional terminal writes
never overwrite recovered history. When ownership cannot be proven, uncertain
history stays running until a later owner can safely recover it. Completed
exact-run results, effective-actor attribution and detached transaction scope
are preserved. Partial imports are **never automatically replayed**. This is
database mutation fencing, not a claim of exactly-once external execution.

### Stalled T631 worker transactions

Only T631 worker mutation units opt into **60-second statement_timeout** and
**15-second idle_in_transaction_session_timeout**, installed with SET LOCAL
before taking either fence. These are business-work limits, not the five-second
coordination deadline. They apply equally to worker changes and the missing-worker
pass, including identity-table lock waits. They do not shorten vendor requests,
change other transaction callers, bypass maintenance, or release either fence
early. Settings revert when the transaction ends.

Sixty seconds allows SQL substantially longer than a coordination operation but
bounds a blocked or stuck statement. Fifteen seconds bounds a stalled JavaScript
callback between queries, including an aborted transaction whose client never
rolls back. Worker units contain database work, not vendor requests; holding
identity and semaphore locks idle for longer is not useful progress. These are
conservative safety ceilings, not measured production performance targets or
permission to extend the lease. Renewal can still fail earlier while the row
is locked, and the normal ownership check must then roll back the unit.

Timeouts and fatal connection errors interrupt the whole import, rather than
being counted as ordinary per-worker failures. The limited transaction owns
its checkout, listens for checked-out client errors, destroys uncertain clients,
and never flushes after-commit callbacks on failure. An idle disconnect settles
the caller even while its JavaScript callback is suspended. If that callback
resumes, it still holds the dead transaction client, not a fresh connection,
and cannot publish a late commit.

A server-side statement timeout cancels SQL; the client normally rolls back
immediately. If the client cannot respond, the idle-in-transaction timeout
subsequently terminates the session and releases both locks. A silent network
partition therefore does not depend solely on TCP failure detection for database
lock release. This is not a hard end-to-end recovery SLA: server overload,
rollback time, failover, pool availability and polling cadence add latency.
An event-loop blocked by synchronous JavaScript cannot be interrupted by a
promise. Many individually short queries are not a whole-transaction deadline.

### Operator recovery procedure

1. Stop new manual and scheduled T631 imports. Do not run another import merely
   to test recovery; partial earlier worker commits may already exist.
2. Inspect the exact run's history and database sessions using an approved DBA
   connection to the affected database. Run the following read-only query (it
   deliberately omits SQL text and worker data):

   ```sql
   SELECT pid, backend_start, application_name, state, xact_start, query_start,
          state_change, wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers
   FROM pg_stat_activity
   WHERE datname = current_database()
     AND application_name = 't631:worker-unit'
   ORDER BY xact_start;
   ```

   Confirm the database, PID, backend start time and lock ownership; use
   `pg_locks` to confirm the retained advisory fence (classid 0, objid 2032002,
   objsubid 1). A blocker may be a different workload holding the identity table;
   do not terminate unrelated blockers without investigating them.
3. Allow the statement/idle limits and rollback to work. Status polling can
   recover history once the old transaction ends and the lease is available.
   An expired semaphore or stale heartbeat alone is **not** proof that locks
   have been released. Never DELETE the semaphore, clear its token, unlock a
   fence, or manually mark the run successful to force recovery.
4. If the session remains stuck, an authorized DBA may terminate **only the
   confirmed T631 worker backend**. Recheck PID and backend_start immediately
   before executing `pg_terminate_backend(pid)`; PIDs can be reused. Termination
   rolls back the current unit. `pg_cancel_backend` alone is insufficient for
   an idle/aborted transaction and may leave locks held until rollback.
   Never terminate every application connection as a shortcut.
5. Confirm that the backend has disappeared and its locks have gone; a true
   return from the termination request is not proof of completed rollback.
   If database termination cannot complete, escalate to the database operator;
   keep imports stopped, rather than relaxing fencing.
6. Poll the exact run to allow normal fenced recovery to record interruption.
   Review partial committed effects before explicitly authorizing a new import.
   Nothing in recovery automatically replays workers. Resume scheduling only
   after that review.

## Deployment

**Before this T631 cutover, drain or stop every old advisory-ownership T631
execution, including manually started imports, before starting new code.**
Stop new manual starts and scheduled imports and let existing executions
finish where possible. The old session advisory ownership key and the new
`t631:sync-workers` semaphore do not coordinate admission. The retained unit
fence is not a substitute for draining: mixed versions can otherwise fetch
and reconcile alternating units. On rollback, likewise drain/stop all
semaphore-owned T631 executions **before** starting advisory-owned code.
Forced termination may leave partial commits; inspect history and effects
before manually deciding whether to run another import. Never replay
automatically.

**Stop every old advisory-lock-based cron process before starting this version.**
Old advisory locks and new semaphore rows do not coordinate, so a mixed-version
rolling rollout can duplicate work. Let old jobs finish where possible; if
terminated, their partial effects remain uncertain. Deploy the additive schema
migration before new scheduling starts. The same stop-all rule applies when
rolling back to the advisory-lock version.
