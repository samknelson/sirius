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
flight are not cancelled or replayed when ownership is lost; another owner's
later tick can overlap that work. Scheduled runs can also overlap when a job
takes longer than its interval, or with a manual run. Existing job-level locks,
including T631 sync ownership and mutation fencing, remain necessary.

All replicas must use the same database and advisory-lock key, and the database
connection path must preserve session affinity. Transaction-pooling proxies
that move queries between database sessions are not compatible with
session-advisory-lock ownership. During the first rollout, old application
versions without election can still schedule independently until retired.
