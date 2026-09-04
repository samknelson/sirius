---
name: Cross-process boot serialization
description: How schema bring-up takes turns between the two services that boot against one database, and what "bounded" means on the boot path.
---

# Two processes boot the same image against one database

The deployment runs ONE image as TWO services (UI + API) against a single
database, and a rollout restarts both at the same instant. Anything on the
boot path therefore runs twice, concurrently, with no leader election and no
shared filesystem.

## The rule

Schema bring-up is exclusive: it runs under a Postgres **session** advisory
lock taken on a dedicated pooled connection (it spans DDL, migrations and
bookkeeping writes that cannot be one transaction). Everything else on the
boot path must be safe to run twice at the same instant.

Three shapes of "safe", in order of preference:

1. an atomic statement (`ON CONFLICT`, upsert) — always first choice;
2. catch the unique violation (`23505`) and **re-read** the row the winner
   created — for check-then-create where a unique key exists;
3. a **transaction-scoped** advisory lock around the whole check-and-write —
   only when there is no unique key to conflict on AND one must not be added
   (e.g. a plugin that may legitimately have several config rows, so
   "exactly one" is not an invariant of the table, only of the seeder).

A read-modify-write is fine without any of these when both processes compute
the *same* value from the same input — the losing write is byte-identical.
Say so in a comment; the next reader will otherwise "fix" it.

**Why:** the loser of an unserialized race either fails on objects the winner
just created (permanent init-failed) or blocks on the winner's locks. Both
were silent: the process deliberately stays alive on boot failure, so the
task never became ready while the load balancer kept it in rotation and the
rollout reported success. Observed in UAT — the UI served the app while every
`/api/*` returned not-ready, and redeploying the same image against the same
database came up clean, which is the signature of a race, not a bad migration.

## Waiting is not repeating

A task that waited for the lock must **re-read the database** and continue
from what it actually finds. It must never re-apply what it was about to
apply before it waited. The lock gives most of this for free (post-lock,
nothing is pending), but two things do not fall out of it:

- a peer's FAILURE — recorded in a `variables` row, so the waiter can refuse
  with the winner's error instead of reproducing it. Critical nuance: only a
  failure that finished **during our wait** is fatal. A stale failure from a
  previous deploy must not refuse the new image that fixes it.
- one-shot recovery variables (a resume-from-version). Both tasks carry the
  same variable; the second must not replay what the first already did.

## Bounded means bounded

Every wait on the boot path has a deadline, because the alternative is a task
that hangs in "initializing" forever:

- the connection pool has a connection timeout;
- the wait for the bring-up lock has a deadline, after which the boot FAILS
  and names the lock as its blocker;
- each bring-up step has a deadline;
- a transaction-scoped lock sets `SET LOCAL lock_timeout`.

A step deadline bounds the WAIT, not the work: rejecting does not cancel the
query, close the connection, or stop the step from finishing later. So a
process that times out INSIDE its mutual exclusion must not release it — the
abandoned work may still be running, and handing the lock over would recreate
the very race. Hold it until the process dies, which is the only moment the
work is provably over. This also means the lock wait itself can never be
configured to "unlimited": a limit you can disable is the hang coming back.

**How to apply:** anything new on the boot path that writes gets one of the
three shapes above; anything new that waits gets a deadline and a named
blocker. Prove concurrency work with two real processes racing one database
(`scripts/oneoffs/verify-concurrent-bringup.ts`) — a unit test cannot.
