---
name: Default connection resolution and boot-seeding a non-singleton config row
description: Why an ambiguous default must be refused rather than guessed, and how to seed a config row at boot when several rows are legitimately allowed.
---

## Refuse an ambiguous default; do not pick one

When a caller asks for "the" connection without naming one and more than one is enabled,
raise a conflict instead of taking the first by ordering.

**Why:** picking by ordering looks harmless because the wrong choice usually still
*works*. It stops looking harmless when the operation is a sync that deactivates every
record absent from the answer it was handed. Two connections then take turns deactivating
each other's members, on a schedule, with nothing in any log looking wrong. A refusal is
noisy and immediate; a silent wrong default corrupts data quietly.

The same split matters in what the resolution throws: **misconfiguration throws, remote
and network conditions return a result.** A scheduled job must not be able to read
"credential broken" as "the vendor says there are no members" — that is the same
deactivation bug arriving by a different road.

**How to apply:** resolve-the-default is its own function with its own error types (none
enabled, more than one enabled), and the ambiguous one carries the competing ids so the
message can name them. Routes must map those statuses through instead of flattening them
to 500.

## Seeding a row at boot when the kind is not a singleton

Seeding from environment values at boot (rather than in a SQL migration) is right when
the decision depends on component state the SQL layer cannot see. The hazard is that
several processes boot the same image against the same database.

**Why:** a check-then-insert is not idempotent across processes, and a kind that
legitimately allows several rows has no `(kind, pluginId)` uniqueness to fall back on. Two
boots both see nothing and both create a row — which lands you straight in the ambiguous
default above.

**How to apply:** give the seeded row a stable value in a column the database already
enforces as unique, and let the database arbitrate. Then attribute the violation rather
than assuming it: the same error code and constraint name is raised by a concurrent
seeder *and* by an operator who happened to type that identifier onto an unrelated row.
Read the winning row back and only treat it as a lost race if it is the row you meant to
create; otherwise report the collision, because the alternative is a component left with
no connection and nothing said about it. Keep the catch outside the transaction so the
loser's subsidiary writes roll back with it.

Decide and then *write down* what deleting the seeded row means. "Seed when none exists"
means an operator who deletes the last one gets a fresh seed on the next boot. That is
defensible — the component cannot work without a connection, and a row naming the missing
secret is a better place to land than no row and no explanation — but only if the comment
says so, because the obvious reading of the code is the opposite.
