# Cron scheduler ownership

Every `api-user` process participates in election. One PostgreSQL session holds
advisory lock `0x43524f4e` ("CRON") for the lifetime of its scheduling authority.
Other service roles do not participate. The connection remains checked out and
is never used for application transactions. Allow one extra database connection
for the elected scheduler; standby attempts use short-lived connections.

Startup does not wait for election. Standbys retry after a random **5–10 seconds**,
without creating job-run records or repeatedly warning about normal contention.
Acquisition/ownership errors retry on the same cadence. Actual acquisition time
also includes connection checkout (the existing `DB_CONNECT_TIMEOUT_MS`, default
15 seconds) and a lock-query deadline of 5 seconds; an unreachable database
cannot promise a takeover deadline.

The owner probes its connection every **5 seconds**, with a **5-second query
deadline**. A driver error/end event withdraws authority immediately; a silent
connection failure is detected within approximately 10 seconds while the event
loop is responsive. A timed-out session is destroyed, not returned to the pool.
Standbys can take over after PostgreSQL releases the old session's lock; they
never steal it because a heartbeat looks old.

Ownership loss destroys cron timers and invalidates their queued callbacks.
Takeover reads current configuration before starting new timers. Reload only
changes the current owner's timers; standbys pick up changes on takeover.
Maintenance startup deferral still applies. Automatic callbacks also refuse to
start while the local maintenance flag is active. Manual runs are independent
of election and retain their existing authorization and execution behavior.

Shutdown, including the application's restart action, closes the ownership
session before closing the database pool. SIGTERM/SIGINT retain their normal
termination semantics after scheduler cleanup.

## Guarantees and limits

This is single-owner **scheduling**, not exactly-once execution. Jobs already in
flight are not cancelled or replayed when scheduler ownership is lost.

Every cron execution also takes a mandatory session advisory lock keyed by
plugin ID (two-int namespace `0x43524a42` plus the first signed 32 bits of SHA-256
of the ID). Scheduled/manual, test/live, and different configurations share the
same lock. Contenders are recorded as skipped, not queued or retried. Different
plugin IDs run concurrently; an unlikely hash collision conservatively serializes
two jobs rather than permitting overlap.

Each running job requires an extra checked-out database connection. Provision
pool capacity for these locks **and** the jobs' normal queries; checkout is
bounded to 15 seconds and queries to 5 seconds. Connections are probed every
5 seconds. Connection failure marks the run interrupted/uncertain and destroys
the session, without reacquisition. Process death releases locks when PostgreSQL
detects session closure; network partitions can delay this detection.

These locks prevent overlapping starts while ownership is healthy, not arbitrary
side effects after connection loss. Already-running JavaScript cannot be
generically cancelled; its eventual result must not be reported as success.
Existing job-level fencing, including T631 mutation fencing, remains necessary.
Scheduler stop/reload does not release execution locks for jobs still running.

All replicas must use the same database and advisory-lock key, and the database
connection path must preserve session affinity. Transaction-pooling proxies
that move queries between database sessions are not compatible with
session-advisory-lock ownership. During the first rollout, old application
versions without election/execution locking can still run independently until retired.
