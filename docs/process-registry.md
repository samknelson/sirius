# Process inventory

`/config/processes` is an admin-only, server-paginated observation of non-ended
backend processes. Reporting means a heartbeat no older than three minutes;
Stale is not confirmed death, readiness, ownership, or permission to take over
work. System Status describes only the process answering that request.

Each backend (`api-user`, `api-ws`, or both) reports independently of cron
ownership after schema bring-up and environment overrides are safe. Pure-static
startup and report-only diagnostics remain database-independent. Processes that
fail before this point cannot appear. A later initialization failure can leave
a reporting process: this is deliberately not a readiness check.

`PROCESS_NAME` is optional, nonsecret, non-unique, and captured once using normal
environment/DB override precedence. Changes require restart. UUID and startup
instant come from the existing pure boot-identity leaf. All registry timestamps
are `timestamptz` instants, not generic provenance.

Heartbeat writes run serially approximately every 60 seconds, retrying failures
after 10 seconds. A missing row is recreated with the original UUID/startup.
Lifecycle transactions alone use the approved maintenance exception. They run
outside ambient request transactions, with bounded database checkout (the shared
pool's `DB_CONNECT_TIMEOUT_MS`), two-second statement and one-second lock limits.
Registration never delays application startup. Shutdown stops scheduling,
waits for the in-flight write, and attempts an idempotent terminal upsert, with
a five-second overall wait before existing shutdown continues. Database loss,
crashes, SIGKILL and forced shutdown can leave `ended_ts` empty.

Retention defaults to ten elapsed days and at most 1,000 deletions per sweep.
Ended rows age by end time; unended rows age by last heartbeat, never startup.
Dry runs only count. Each delete rechecks expiry atomically; retention has no
maintenance exception. JSON `data` is application-managed extension space and
is neither exposed in the list nor populated from environment/configuration.
There is no storage audit wrapper or entity metadata for these observations.

## Verification

Focused tests cover serialized retry/stop behavior, a bounded stop during a hung
write, SQL lifecycle/expiry guards, matching paginated filters, dry-run bounds,
and the route's admin-policy and pagination contract. A development PostgreSQL
exercise also verified maintenance lifecycle writes versus refused retention,
original-start recreation, heartbeat/delete and heartbeat/end races, independent
read-only caller transactions, and two independent role-labelled processes
terminated by SIGTERM versus SIGKILL. Temporary database fixtures were removed.

The running app passed schema bring-up and refused an unauthenticated inventory
request with the admin policy. The preview rendered sign-in; the authenticated
Processes page was not visually verified. These checks do not simulate host
network partitions or orchestrator force-kill deadlines.
