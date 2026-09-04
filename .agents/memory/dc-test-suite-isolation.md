---
name: BAO DB suites — schema bring-up and fixture ownership
description: Why BAO vitest suites must never run component migrations directly and must own their fixture workers.
---

**Rule:** a DB suite never calls a component migration's `up()` from
`beforeAll`; it goes through the shared bring-up fixture under
`tests/sitespecific/fixtures/`, which uses the application's own component
migration runner (no DDL when the schema is already current) behind a session
advisory lock. Suites that write to a table with a one-live-row-per-worker
guard create their own fixture worker instead of sharing `getAllWorkers()[0]`.

**Why:** vitest runs files in parallel forks. Direct `up()` calls deadlocked
(`40P01`) two ways: concurrent `CREATE ... IF NOT EXISTS` on catalog locks, and
— worse — the later migrations re-issue DROP/ADD CONSTRAINT and table UPDATEs on
EVERY run, so even a serialized re-application took ACCESS EXCLUSIVE locks while
another suite was already inserting rows. Sharing a database worker across
suites raced on DUPLICATE_OPEN_CASE, and a "baseline snapshot" of a global queue
is not enough when other suites enqueue concurrently — exclude foreign rows at
call time.

**How to apply:** new BAO suite → import the fixture's `ensure…Schema()`; new
component table set → add it to the fixture (raw list + lead table) rather than
importing migrations into the suite. When a suite is green alone but red in the
full run, look for shared rows (workers, global queues) before suspecting code.
