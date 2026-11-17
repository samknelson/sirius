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
lock used by cron. The whole checkout/transaction is bounded to 5 seconds;
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
semaphores and cron run-history. Plugin work is never inside them. Existing
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
fencing. T631's existing mutation fencing remains essential. No generic plugin
cancellation or automatic replay is introduced.

## Deployment

**Stop every old advisory-lock-based cron process before starting this version.**
Old advisory locks and new semaphore rows do not coordinate, so a mixed-version
rolling rollout can duplicate work. Let old jobs finish where possible; if
terminated, their partial effects remain uncertain. Deploy the additive schema
migration before new scheduling starts. The same stop-all rule applies when
rolling back to the advisory-lock version.
